import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvalStatus, EvalTestResult } from '../src/index.js';
import { report, setup } from './helpers.js';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('test execution', () => {
  it.each<EvalStatus>(['pass', 'warning', 'fail', 'error'])('preserves a single %s result without retrying', async status => {
    const { ripple, context } = setup({ retries: 2 });
    const result = { status, details: 'evaluation details' };
    const test = vi.fn(async () => result);
    const actual = await ripple.runTest('example', test, context);
    expect(actual).toEqual({ name: 'example', duration: expect.any(Number), result });
    expect(actual.duration).toBeGreaterThanOrEqual(0);
    expect(test).toHaveBeenCalledExactlyOnceWith(context);
  });

  it.each([
    [['pass', 'pass', 'fail'], 'pass', 2 / 3],
    [['pass', 'fail'], 'fail', 0.5],
    [['warning', 'error', 'fail'], 'fail', 0],
  ] as [EvalStatus[], EvalStatus, number][])('aggregates trials %j', async (statuses, status, passRate) => {
    const { ripple, context, target } = setup();
    const results = statuses.map(status => ({ status }));
    let index = 0;
    const run = vi.fn(async () => {
      expect(context.interactions).toEqual([]);
      await context.send('trial');
      return results[index++]!;
    });
    const actual = await ripple.runTest('repeated', { trials: statuses.length, run }, context);
    expect(actual.result).toEqual({ status, passRate, results });
    expect(run).toHaveBeenCalledTimes(statuses.length);
    expect(target.reset).toHaveBeenCalledTimes(statuses.length - 1);
  });

  it('returns the original result for an object with one trial', async () => {
    const { ripple, context } = setup();
    expect((await ripple.runTest('one', { trials: 1, run: async () => ({ status: 'warning' }) }, context)).result).toEqual({ status: 'warning' });
  });

  it('resets history before retrying a thrown error', async () => {
    const { ripple, context, target } = setup({ retries: 1 });
    const test = vi.fn()
      .mockImplementationOnce(async () => { await context.send('failed attempt'); throw new Error('temporary'); })
      .mockImplementationOnce(async () => { expect(context.interactions).toEqual([]); return { status: 'pass' }; });
    expect((await ripple.runTest('retry', test, context)).result).toEqual({ status: 'pass' });
    expect(test).toHaveBeenCalledTimes(2);
    expect(target.reset).toHaveBeenCalledOnce();
  });

  it.each([new Error('last failure'), 'last failure'])('reports the final error when retries are exhausted: %s', async error => {
    const { ripple, context, target } = setup({ retries: 2 });
    const test = vi.fn().mockRejectedValue(error);
    expect((await ripple.runTest('broken', test, context)).result).toEqual({ status: 'error', details: 'last failure' });
    expect(test).toHaveBeenCalledTimes(3);
    expect(target.reset).toHaveBeenCalledTimes(2);
  });

  it('times out each attempt and exhausts the retry budget', async () => {
    vi.useFakeTimers();
    const { ripple, context, target } = setup({ timeout: 100, retries: 1 });
    const test = vi.fn(() => new Promise<EvalTestResult>(() => {}));
    const pending = ripple.runTest('slow', test, context);
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).result).toEqual({ status: 'error', details: 'Test timed out after 100ms' });
    expect(test).toHaveBeenCalledTimes(2);
    expect(target.reset).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears timeout timers after successful execution', async () => {
    vi.useFakeTimers();
    const { ripple, context } = setup({ timeout: 100 });
    expect((await ripple.runTest('fast', async () => ({ status: 'pass' }), context)).result.status).toBe('pass');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('suite execution', () => {
  it('counts every status, isolates tests, and disposes its target', async () => {
    const { ripple, target, config } = setup();
    const statuses: EvalStatus[] = ['pass', 'warning', 'fail', 'error'];
    const tests = Object.fromEntries(statuses.map(status => [status, async (context: Parameters<typeof ripple.runTest>[2]) => {
      expect(context.interactions).toEqual([]);
      await context.send(status);
      if (status === 'error') throw new Error('broken');
      return { status };
    }]));
    const result = await ripple.runSuite({ name: 'mixed', description: 'all statuses', tests });
    expect(result).toMatchObject({ name: 'mixed', description: 'all statuses', result: { total: 4, passed: 1, failed: 1, warnings: 1, errors: 1 } });
    expect(Object.keys(result.result.tests)).toEqual(statuses);
    expect(config.targetFactory).toHaveBeenCalledOnce();
    expect(target.reset).toHaveBeenCalledTimes(4);
    expect(target.dispose).toHaveBeenCalledOnce();
  });

  it('disposes the target when resetting it fails', async () => {
    const { ripple, target } = setup();
    target.reset.mockRejectedValueOnce(new Error('reset failed'));
    const test = vi.fn(async (): Promise<EvalTestResult> => ({ status: 'pass' }));
    await expect(ripple.runSuite({ name: 'broken', description: '', tests: { test } })).rejects.toThrow('reset failed');
    expect(test).not.toHaveBeenCalled();
    expect(target.dispose).toHaveBeenCalledOnce();
  });
});

describe('baseline comparison', () => {
  const statuses: EvalStatus[] = ['pass', 'warning', 'fail', 'error'];
  it.each(statuses.flatMap((before, i) => statuses.map((after, j) => ({ before, after, worse: j > i }))))('compares $before -> $after', ({ before, after, worse }) => {
    const { ripple } = setup();
    expect(ripple.compareBaseline(report({ test: { status: before } }), report({ test: { status: after } }))).toEqual({
      regressions: worse ? [`suite -> test: ${before} -> ${after}`] : [], warnings: [],
    });
  });

  it.each([[0.5, false], [0.49, true], [1, false]])('warns only beyond the pass rate threshold: %s', (passRate, warning) => {
    const { ripple } = setup({ passRate_warning_threshold: 0.25 });
    const baseline = report({ test: { status: 'pass', passRate: 0.75 } });
    const current = report({ test: { status: 'pass', passRate } });
    expect(ripple.compareBaseline(baseline, current)).toEqual({ regressions: [], warnings: warning ? [`suite -> test: passRate 0.75 -> ${passRate}`] : [] });
  });

  it('ignores unmatched suites and tests', () => {
    const { ripple } = setup();
    const baseline = report({ removed: { status: 'pass' } });
    const current = report({ added: { status: 'error' } });
    current.suites.push(...report({ removed: { status: 'error' } }, 'new suite').suites);
    expect(ripple.compareBaseline(baseline, current)).toEqual({ regressions: [], warnings: [] });
  });
});
