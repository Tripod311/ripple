import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { report, setup } from './helpers.js';

let directory: string;
let originalExitCode: typeof process.exitCode;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ripple-test-'));
  originalExitCode = process.exitCode;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

async function suite(filename: string, name: string, status = 'pass') {
  await writeFile(path.join(directory, filename), `export default {
    name: ${JSON.stringify(name)}, description: 'fixture',
    tests: { test: async (ctx) => { await ctx.send('hello'); return { status: ${JSON.stringify(status)} }; } }
  };`);
}

async function saved(out: string) {
  const files = await readdir(out);
  expect(files).toHaveLength(1);
  return JSON.parse(await readFile(path.join(out, files[0]!), 'utf8'));
}

describe('run integration', () => {
  it('awaits the hook, loads suites in filename order, aggregates and saves results', async () => {
    await suite('b.mjs', 'second', 'warning');
    await suite('a.mjs', 'first');
    const out = path.join(directory, 'nested', 'results');
    const { ripple, config, target, judge } = setup({ out });
    config.judgeFactory = vi.fn(async () => judge);
    config.hooks = { beforeAll: vi.fn(async conf => {
      await Promise.resolve();
      conf.execution.in.push(path.join(directory, '*.mjs'));
      conf.fingerprint = 'test-version';
    }) };
    await ripple.run();
    const result = await saved(out);
    expect(result.fingerprint).toBe('test-version');
    expect(result.result).toEqual({ total: 2, passed: 1, failed: 0, warnings: 1, errors: 0 });
    expect(result.suites.map((s: { name: string }) => s.name)).toEqual(['first', 'second']);
    expect(config.hooks.beforeAll).toHaveBeenCalledExactlyOnceWith(config);
    expect(config.targetFactory).toHaveBeenCalledTimes(2);
    expect(target.send).toHaveBeenCalledTimes(2);
    expect(target.dispose).toHaveBeenCalledTimes(2);
    expect(config.judgeFactory).toHaveBeenCalledOnce();
    expect(judge.dispose).toHaveBeenCalledOnce();
  });

  it('passes the configured judge to evaluation tests', async () => {
    await writeFile(path.join(directory, 'judge.mjs'), `export default {
      name: 'judged', description: '', tests: { test: async ctx => {
        await ctx.send('hello'); return ctx.evaluate('polite');
      } }
    };`);
    const { ripple, config, judge } = setup({ in: [path.join(directory, '*.mjs')] });
    config.judgeFactory = async () => judge;
    await ripple.run();
    expect(judge.evaluate).toHaveBeenCalledWith({ criteria: 'polite', interactions: [{ input: 'hello', output: 'hello' }], metadata: undefined });
    expect(judge.dispose).toHaveBeenCalledOnce();
  });

  it('handles patterns with no matching suites without creating a target', async () => {
    const out = path.join(directory, 'results');
    const { ripple, config } = setup({ in: [path.join(directory, '*.mjs')], out });
    await ripple.run();
    expect((await saved(out)).result).toEqual({ total: 0, passed: 0, failed: 0, warnings: 0, errors: 0 });
    expect(config.targetFactory).not.toHaveBeenCalled();
  });

  it.each([true, false])('sets exit code for regressions only when enabled: %s', async failOnRegression => {
    await suite('suite.mjs', 'suite', 'fail');
    const baseline = path.join(directory, 'baseline.json');
    await writeFile(baseline, JSON.stringify(report({ test: { status: 'pass' } })));
    const { ripple } = setup({ in: [path.join(directory, '*.mjs')], baseline, failOnRegression });
    process.exitCode = 0;
    await ripple.run();
    expect(process.exitCode).toBe(failOnRegression ? 1 : 0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('suite -> test: pass -> fail'));
  });

  it('reports a matching baseline', async () => {
    await suite('suite.mjs', 'suite');
    const baseline = path.join(directory, 'baseline.json');
    await writeFile(baseline, JSON.stringify(report({ test: { status: 'pass' } })));
    const { ripple } = setup({ in: [path.join(directory, '*.mjs')], baseline });
    await ripple.run();
    expect(console.log).toHaveBeenCalledWith('All tests matched the baseline.');
  });

  it.each(['missing', 'invalid'])('reports %s baseline and skips execution', async kind => {
    await suite('suite.mjs', 'suite');
    const baseline = path.join(directory, 'baseline.json');
    if (kind === 'invalid') await writeFile(baseline, 'not json');
    const { ripple, config } = setup({ in: [path.join(directory, '*.mjs')], baseline });
    await ripple.run();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to load baseline:'));
    expect(config.targetFactory).not.toHaveBeenCalled();
  });

  it('logs judge disposal failures without rejecting the run', async () => {
    const { ripple, config, judge } = setup();
    config.judgeFactory = async () => judge;
    judge.dispose.mockRejectedValue(new Error('cleanup failed'));
    await expect(ripple.run()).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith('Error on judge dispose: Error: cleanup failed');
  });
});

describe('saveResult', () => {
  it('writes timestamped JSON with the configured fingerprint to an existing directory', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.006Z'));
    const out = path.join(directory, 'results');
    await mkdir(out);
    const { ripple, config } = setup({ out });
    config.fingerprint = 'v2';
    const result = report({ test: { status: 'pass' } });
    await ripple.saveResult(result);
    expect(await readdir(out)).toEqual(['result-2026-01-02T03-04-05-006Z.json']);
    expect(await saved(out)).toEqual({ ...result, fingerprint: 'v2' });
  });

  it('does not write files when output is not configured', async () => {
    const { ripple } = setup();
    await ripple.saveResult(report({}));
    expect(console.log).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
});
