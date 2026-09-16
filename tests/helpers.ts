import { vi } from 'vitest';
import { EvalContext, Ripple } from '../src/index.js';
import type { RippleConfiguration, EvalTestResult, EvalRunResult, JudgeInput } from '../src/index.js';

export function resources() {
  const target = {
    send: vi.fn(async (input: unknown, _signal: AbortSignal): Promise<unknown> => input),
    snapshot: vi.fn(async (_signal: AbortSignal): Promise<unknown> => ({ state: 'ready' })),
    dispose: vi.fn(async () => {}),
  };
  const judge = {
    evaluate: vi.fn(async (_input: JudgeInput, _signal: AbortSignal): Promise<EvalTestResult> => ({ status: 'pass' })),
    dispose: vi.fn(async () => {}),
  };
  return { target, judge };
}

export function setup(execution: Partial<RippleConfiguration['execution']> = {}) {
  const targets: ReturnType<typeof resources>['target'][] = [];
  const judges: ReturnType<typeof resources>['judge'][] = [];
  const config = {
    targetFactory: vi.fn(async () => {
      const { target } = resources();
      targets.push(target);
      return target;
    }),
    judgeFactory: vi.fn(async () => {
      const { judge } = resources();
      judges.push(judge);
      return judge;
    }),
    execution,
  } satisfies RippleConfiguration;
  return { targets, judges, config, ripple: new Ripple(config) };
}

export async function setupContext() {
  const { target, judge } = resources();
  const context = new EvalContext();
  await context.init(async () => target, async () => judge);
  return { context, target, judge };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

export function report(tests: Record<string, EvalTestResult>, name = 'suite'): EvalRunResult {
  const counts = { total: Object.keys(tests).length, passed: 0, failed: 0, warnings: 0, errors: 0 };
  for (const { status } of Object.values(tests)) {
    counts[({ pass: 'passed', fail: 'failed', warning: 'warnings', error: 'errors' } as const)[status]]++;
  }
  return {
    result: { ...counts },
    suites: [{ name, result: { ...counts, tests: Object.fromEntries(
      Object.entries(tests).map(([name, result]) => [name, { name, result }]),
    ) } }],
  };
}
