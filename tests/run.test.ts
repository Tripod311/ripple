import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ripple } from '../src/index.js';
import type { EvalStatus, EvalSuite } from '../src/index.js';
import { report, setup } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

describe('run integration', () => {
  it('awaits beforeAll, runs registered suites in order, and returns a result tuple', async () => {
    const { config, targets, judges } = setup();
    const order: string[] = [];
    const beforeAll = vi.fn(async () => { await Promise.resolve(); order.push('hook'); });
    const ripple = new Ripple({ ...config, hooks: { beforeAll } });
    const statuses: EvalStatus[] = ['pass', 'warning', 'fail', 'error'];
    const suite: EvalSuite = {
      name: 'mixed', description: 'all statuses',
      tests: Object.fromEntries(statuses.map(status => [status, async context => {
        expect(order[0]).toBe('hook');
        order.push(status);
        expect(context.interactions).toEqual([]);
        await context.send(status);
        if (status === 'error') throw new Error('broken');
        return { status };
      }])),
    };
    ripple.addSuite(suite);
    ripple.addSuite({ name: 'judged', description: '', tests: { test: async context => {
      await context.send('hello');
      return context.evaluate('polite');
    } } });
    const [result, regressions, warnings] = await ripple.run();
    expect(result.result).toEqual({ total: 5, passed: 2, failed: 1, warnings: 1, errors: 1 });
    expect(result.suites.map(s => s.name)).toEqual(['mixed', 'judged']);
    expect(order).toEqual(['hook', ...statuses]);
    expect(beforeAll).toHaveBeenCalledOnce();
    expect(regressions).toEqual([]);
    expect(warnings).toEqual([]);
    expect(config.targetFactory).toHaveBeenCalledTimes(5);
    expect(config.judgeFactory).toHaveBeenCalledTimes(5);
    expect(judges[4]!.evaluate).toHaveBeenCalledWith({ criteria: 'polite', interactions: [{ input: 'hello', output: 'hello' }], metadata: undefined }, expect.any(AbortSignal));
    for (const target of targets) expect(target.dispose).toHaveBeenCalledOnce();
    for (const judge of judges) expect(judge.dispose).toHaveBeenCalledOnce();
  });

  it('does not allocate resources for an empty suite or run', async () => {
    const { ripple, config } = setup();
    const [empty] = await ripple.run();
    expect(empty.suites).toEqual([]);
    expect(empty.result.total).toBe(0);
    ripple.addSuite({ name: 'empty', description: '', tests: {} });
    const [result] = await ripple.run();
    expect(result.suites).toHaveLength(1);
    expect(config.targetFactory).not.toHaveBeenCalled();
    expect(config.judgeFactory).not.toHaveBeenCalled();
  });

  it.each([false, true])('returns baseline differences independently of verbose=%s', async verbose => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const baseline = report({ regression: { status: 'pass' }, rate: { status: 'pass', passRate: 1 } });
    const { ripple } = setup({ baseline, verbose });
    let trial = 0;
    ripple.addSuite({ name: 'suite', description: '', tests: {
      regression: async () => ({ status: 'fail' }),
      rate: { trials: 3, run: async () => ({ status: ++trial < 3 ? 'pass' : 'fail' }) },
    } });
    const [result, regressions, warnings] = await ripple.run();
    expect(result.result).toEqual({ total: 2, passed: 1, failed: 1, warnings: 0, errors: 0 });
    expect(regressions).toEqual(['suite -> regression: pass -> fail']);
    expect(warnings).toEqual([`suite -> rate: passRate 1 -> ${2 / 3}`]);
    if (verbose) expect(log).toHaveBeenCalledWith('Differences from the baseline were detected.');
    else expect(log).not.toHaveBeenCalled();
  });

  it('lets beforeAll update the configuration used by this run', async () => {
    const { config } = setup();
    const ripple = new Ripple({ ...config, hooks: { beforeAll: async conf => {
      conf.execution.baseline = report({ test: { status: 'pass' } });
    } } });
    ripple.addSuite({ name: 'suite', description: '', tests: { test: async () => ({ status: 'fail' }) } });
    expect((await ripple.run())[1]).toEqual(['suite -> test: pass -> fail']);
  });
});
