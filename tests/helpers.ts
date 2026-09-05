import { vi } from 'vitest';
import { EvalContext, Ripple, validateConfig } from '../src/index.js';
import type { RippleConfiguration, EvalTestResult, EvalRunResult } from '../src/index.js';

export function setup(execution: Partial<RippleConfiguration['execution']> = {}) {
  const target = {
    send: vi.fn(async (input: unknown) => input),
    snapshot: vi.fn(async () => ({ state: 'ready' })),
    reset: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
  const judge = {
    evaluate: vi.fn(async (): Promise<EvalTestResult> => ({ status: 'pass' })),
    dispose: vi.fn(async () => {}),
  };
  const config = validateConfig({
    targetFactory: vi.fn(async () => target),
    execution: { in: [], ...execution },
  });
  return { target, judge, config, context: new EvalContext(target, judge), ripple: new Ripple(config) };
}

export function report(tests: Record<string, EvalTestResult>, name = 'suite'): EvalRunResult {
  const counts = { total: Object.keys(tests).length, passed: 0, failed: 0, warnings: 0, errors: 0 };
  return {
    result: { ...counts },
    suites: [{ name, result: { ...counts, tests: Object.fromEntries(
      Object.entries(tests).map(([name, result]) => [name, { name, result }]),
    ) } }],
  };
}
