import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvalContext, EvalStatus, EvalTestResult } from '../src/index.js';
import { deferred, report, setup } from './helpers.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('test execution', () => {
  it.each<EvalStatus>(['pass', 'warning', 'fail', 'error'])('preserves a returned %s without retrying', async status => {
    const { ripple, targets, judges } = setup({ retries: 2 });
    const test = vi.fn(async (): Promise<EvalTestResult> => ({ status, details: 'details' }));
    const actual = await ripple.runTest('example', test);
    expect(actual).toEqual({ name: 'example', duration: expect.any(Number), result: { status, details: 'details' } });
    expect(test).toHaveBeenCalledOnce();
    expect(targets).toHaveLength(1);
    expect(targets[0]!.dispose).toHaveBeenCalledOnce();
    expect(judges[0]!.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    [['pass', 'pass', 'fail'], 'pass', 2 / 3],
    [['pass', 'fail'], 'fail', 0.5],
    [['warning', 'error', 'fail'], 'fail', 0],
  ] as [EvalStatus[], EvalStatus, number][])('aggregates trials %j with independent resources', async (statuses, status, passRate) => {
    const { ripple, targets, judges } = setup();
    const contexts: EvalContext[] = [];
    const results = statuses.map(status => ({ status }));
    const actual = await ripple.runTest('trials', { trials: statuses.length, run: async context => {
      expect(context.interactions).toEqual([]);
      contexts.push(context);
      await context.send('trial');
      return results[contexts.length - 1]!;
    } });
    expect(actual.result).toEqual({ status, passRate, results });
    expect(new Set(contexts).size).toBe(statuses.length);
    expect(new Set(targets).size).toBe(statuses.length);
    expect(new Set(judges).size).toBe(statuses.length);
    for (const target of targets) expect(target.dispose).toHaveBeenCalledOnce();
    for (const judge of judges) expect(judge.dispose).toHaveBeenCalledOnce();
  });

  it.each([1, 0, -1, 1.5, NaN, Infinity, -Infinity])('runs once for trials=%s', async trials => {
    const { ripple } = setup();
    const run = vi.fn(async (): Promise<EvalTestResult> => ({ status: 'warning' }));
    expect((await ripple.runTest('one', { trials, run })).result).toEqual({ status: 'warning' });
    expect(run).toHaveBeenCalledOnce();
  });

  it('retries exceptions with fresh resources and closes the failed context', async () => {
    const { ripple, targets, judges } = setup({ retries: 1 });
    const contexts: EvalContext[] = [];
    const result = await ripple.runTest('retry', async context => {
      contexts.push(context);
      expect(context.interactions).toEqual([]);
      await context.send('attempt');
      if (contexts.length === 1) throw new Error('temporary');
      await expect(contexts[0]!.send('late')).rejects.toThrow('Aborted');
      return { status: 'pass' };
    });
    expect(result.result.status).toBe('pass');
    expect(targets).toHaveLength(2);
    expect(judges).toHaveLength(2);
    for (const target of targets) expect(target.dispose).toHaveBeenCalledOnce();
    for (const judge of judges) expect(judge.dispose).toHaveBeenCalledOnce();
  });

  it.each([new Error('last failure'), 'last failure'])('reports exhausted retries: %s', async error => {
    const { ripple, targets, judges } = setup({ retries: 2 });
    const test = vi.fn().mockRejectedValue(error);
    expect((await ripple.runTest('broken', test)).result).toEqual({ status: 'error', details: 'last failure' });
    expect(test).toHaveBeenCalledTimes(3);
    for (const target of targets) expect(target.dispose).toHaveBeenCalledOnce();
    for (const judge of judges) expect(judge.dispose).toHaveBeenCalledOnce();
  });

  it('times out every attempt, aborts signals, and releases resources', async () => {
    vi.useFakeTimers();
    const { ripple, targets, judges } = setup({ timeout: 100, retries: 1 });
    const test = vi.fn(async (context: EvalContext) => {
      await context.send('hello');
      return await new Promise<EvalTestResult>(() => {});
    });
    const pending = ripple.runTest('slow', test);
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).result).toEqual({ status: 'error', details: 'Test timed out after 100ms' });
    expect(test).toHaveBeenCalledTimes(2);
    for (const target of targets) {
      expect(target.send.mock.calls[0]![1].aborted).toBe(true);
      expect(target.dispose).toHaveBeenCalledOnce();
    }
    for (const judge of judges) expect(judge.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a timed-out response out of the retry context', async () => {
    vi.useFakeTimers();
    const { ripple, config, targets } = setup({ timeout: 100, retries: 1 });
    const late = deferred<unknown>();
    const makeTarget = config.targetFactory.getMockImplementation()!;
    config.targetFactory.mockImplementationOnce(async () => {
      const target = await makeTarget();
      target.send.mockReturnValue(late.promise);
      return target;
    });
    const contexts: EvalContext[] = [];
    const pending = ripple.runTest('isolated', async context => {
      contexts.push(context);
      await context.send('hello');
      return { status: 'pass' };
    });
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).result.status).toBe('pass');
    late.resolve('late reply');
    await vi.advanceTimersByTimeAsync(0);
    expect(contexts).toHaveLength(2);
    expect(contexts[0]!.interactions).toEqual([]);
    expect(contexts[1]!.interactions).toEqual([{ input: 'hello', output: 'hello' }]);
    expect(targets[0]).not.toBe(targets[1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('clears timers after completion (throws=%s)', async throws => {
    vi.useFakeTimers();
    const { ripple } = setup({ timeout: 100 });
    const result = await ripple.runTest('fast', async () => {
      if (throws) throw new Error('failed');
      return { status: 'pass' };
    });
    expect(result.result.status).toBe(throws ? 'error' : 'pass');
    expect(vi.getTimerCount()).toBe(0);
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
