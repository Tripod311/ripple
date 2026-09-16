# Ripple

A lightweight, provider-agnostic evaluation and regression testing library for LLM applications and AI agents.

Write ordinary JavaScript or TypeScript tests around your application's target and judge adapters. Ripple runs them, retries execution errors, aggregates repeated trials, and compares results with an accepted baseline.

The library has no Node.js runtime dependencies. It uses standard JavaScript and Web APIs: `AbortController`, `AbortSignal`, `performance.now()`, timers, and `console`. Your adapters determine any additional runtime requirements.

## Installation

```bash
npm install @tripod311/ripple
```

## Quick start

This complete example uses a deterministic target and judge. Replace the factories with adapters for your application or model provider.

```ts
import { Ripple } from '@tripod311/ripple';
import type { RippleConfiguration, EvalSuite } from '@tripod311/ripple';

const config: RippleConfiguration = {
  // Each invocation creates an independent session for one attempt.
  targetFactory: async () => {
    const messages: string[] = [];
    return {
      async send(input, signal) {
        signal.throwIfAborted();
        const output = `Hello, ${String(input)}!`;
        messages.push(output);
        return output;
      },
      async snapshot(signal) {
        signal.throwIfAborted();
        return [...messages];
      },
      async dispose() {
        messages.length = 0;
      },
    };
  },
  judgeFactory: async () => ({
    async evaluate(input, signal) {
      signal.throwIfAborted();
      const polite = input.interactions?.every(
        interaction => String(interaction.output).startsWith('Hello,'),
      );
      return { status: polite ? 'pass' : 'fail' };
    },
    async dispose() {},
  }),
  execution: {
    timeout: 30_000,
    retries: 2,
  },
};

const suite: EvalSuite = {
  name: 'greetings',
  description: 'Greeting behavior',
  tests: {
    async exact_response(ctx) {
      const reply = await ctx.send('world');
      return { status: reply === 'Hello, world!' ? 'pass' : 'fail' };
    },
    polite_conversation: {
      trials: 3,
      async run(ctx) {
        await ctx.send('Alice');
        await ctx.send('Bob');
        return ctx.evaluate('Greet the user politely', { language: 'en' });
      },
    },
  },
};

const ripple = new Ripple(config);
ripple.addSuite(suite);

const [result, regressions, warnings] = await ripple.run();
console.log(result.result);
console.log({ regressions, warnings });
```

Register suites explicitly with `addSuite()`. Suites and their tests execute sequentially in registration and object-entry order. There is no separate `Ripple.init()` or `Ripple.dispose()` step.

Ripple does not discover files, load suites from glob patterns, save reports, or set a process exit code. Import suites and persist or publish results in your application using the facilities of your runtime.

## Target and judge adapters

Both factories are required, even if a particular test does not call `ctx.evaluate()`. The judge can implement ordinary deterministic checks; it does not need to use an LLM.

The adapter contracts are:

```ts
interface EvalTarget<Input = unknown, Output = unknown, Snapshot = unknown> {
  send(input: Input, signal: AbortSignal): Promise<Output>;
  snapshot(signal: AbortSignal): Promise<Snapshot>;
  dispose(): Promise<void>;
}

type EvalTargetFactory<Input = unknown, Output = unknown, Snapshot = unknown> =
  () => Promise<EvalTarget<Input, Output, Snapshot>>;

interface JudgeInput {
  criteria: string;
  interactions?: { input: unknown; output: unknown }[];
  metadata?: Record<string, unknown> | undefined;
}

interface Judge {
  evaluate(input: JudgeInput, signal: AbortSignal): Promise<EvalTestResult>;
  dispose(): Promise<void>;
}

type JudgeFactory = () => Promise<Judge>;
```

`EvalTestResult` is exported by the package and described below. Target input, output, and snapshot values are application-defined; the runner's configuration uses their default `unknown` types, so narrow values when necessary.

Forward the supplied signal into cancellable operations. For example, inside an HTTP target's `send` method:

```ts
const response = await fetch('/api/evaluate-target', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
  signal,
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
return await response.json();
```

Factories must create independent resources and external sessions. Returning a singleton, or attaching new objects to the same mutable conversation, defeats isolation. Factory initialization and resource disposal are the adapter author's responsibility; the test timeout does not cover them. Errors from factories or disposal can reject the run.

## Context and attempt lifecycle

An **attempt** is one invocation of a test function. Every trial and every retry receives a new `EvalContext`, target, judge, and abort controller. There is no target or context `reset()` API.

The context exposes:

| Member | Behavior |
| --- | --- |
| `send(input)` | Sends input and records a successful `{ input, output }` interaction. |
| `snapshot()` | Returns the target's application-defined snapshot. |
| `evaluate(criteria, metadata?)` | Passes criteria, recorded interactions, and optional metadata to the judge. |
| `interactions` | The conversation recorded for this attempt. |
| `abort()` | Signals cancellation and blocks further context operations. |

Each operation checks cancellation before calling the adapter and after awaiting its result. A late `send` response after cancellation is not added to the interaction history.

After test execution finishes, whether successfully, by exception, or by timeout, Ripple disposes the context: it aborts its signal and calls the target and judge disposal methods. The next attempt gets new resources.

Timeouts request cancellation; they do not forcibly stop arbitrary JavaScript or undo external side effects. Adapters must honor the signal, and test code should await its asynchronous work. The same-thread timer cannot interrupt a synchronous infinite loop.

For direct use outside the runner, `EvalContext` also exposes `init(targetFactory, judgeFactory)` and `dispose()`. Initialize a fresh context before use and dispose it afterward. A disposed context cannot be reused.

## Configuration

The `Ripple` constructor calls `validateConfig()` to validate and normalize the supplied configuration. You can also import that function separately. It returns a new configuration and execution-options object.

| Option | Meaning / default |
| --- | --- |
| `targetFactory` | Required factory for a target per attempt. |
| `judgeFactory` | Required factory for a judge per attempt. |
| `execution` | Required options object; `{}` is valid. |
| `execution.timeout` | Optional finite positive timeout in milliseconds for test execution, after factories finish. No timeout by default. |
| `execution.retries` | Non-negative integer: additional attempts after thrown errors or timeouts. Default `0`. |
| `execution.baseline` | Optional previous `EvalRunResult` object, not a file path. |
| `execution.passRate_warning_threshold` | Allowed pass-rate drop before a warning. Default `0.05`. |
| `execution.verbose` | Enable progress and baseline-comparison logs. Disabled by default. |
| `hooks.beforeAll` | Optional async hook, awaited once at the start of each `run()`, before resource creation. Receives the runner's configuration. |
| `fingerprint` | Optional application metadata accepted by configuration. Currently not copied into the returned report automatically. |

A hook can update the configuration used by that run:

```ts
const ripple = new Ripple({
  ...config,
  hooks: {
    async beforeAll(conf) {
      conf.execution.verbose = true;
    },
  },
});
```

Hook updates are not automatically revalidated. If you need a fingerprint in your stored report, assign `result.fingerprint` yourself before saving it.

## Tests, trials, and retries

An `EvalSuite` contains `name`, `description`, and a `tests` record. A test is either an async function returning `EvalTestResult`, or an object containing that function as `run` and a numeric `trials` count.

```ts
import type { EvalTest } from '@tripod311/ripple';

const repeated: EvalTest = {
  trials: 5,
  async run(ctx) {
    await ctx.send('Explain the cancellation policy.');
    return ctx.evaluate('The answer is accurate and concise.');
  },
};
```

Invalid trial counts (non-integers, non-positive values, `NaN`, or infinities) fall back to one trial.

A single trial preserves the test's result. With multiple trials:

- `passRate` is the number of `pass` results divided by the trial count.
- The aggregate status is `pass` only when `passRate > 0.5`; otherwise it is `fail`.
- `warning`, `fail`, and `error` trials all count as non-passes.
- Individual trial results are retained in `results`.

Retries apply to thrown exceptions and timeouts. Returning `{ status: 'fail' }` or `{ status: 'error' }` does not trigger a retry. Each trial has its own retry budget. After that budget is exhausted, the trial returns `error` with the last exception's message (or its string representation).

## Results and baselines

Tests return:

```ts
interface EvalTestResult {
  status: 'pass' | 'fail' | 'warning' | 'error';
  details?: string | undefined;
  passRate?: number | undefined;
  results?: EvalTestResult[] | undefined;
}
```

`await ripple.run()` returns `[result, regressions, warnings]`:

- `result` is an `EvalRunResult`, with overall counts and a `suites` array. Each suite contains counts and named test results, including durations in milliseconds. Counts represent tests, not attempts or trials.
- `regressions` contains human-readable status regressions.
- `warnings` contains human-readable pass-rate drops. This is separate from the count of tests whose status is `warning`.

With no registered suites, the report has zero counts and an empty suite list.

Pass an accepted previous report directly as the baseline:

```ts
import type { EvalRunResult } from '@tripod311/ripple';

async function compareWithBaseline(baseline: EvalRunResult) {
  const ripple = new Ripple({
    ...config,
    execution: {
      ...config.execution,
      baseline,
      passRate_warning_threshold: 0.1,
    },
  });
  ripple.addSuite(suite);
  const [result, regressions, warnings] = await ripple.run();
  // Your application decides how to save the report or fail a CI job.
  return { result, regressions, warnings };
}
```

Comparison matches suites and tests by name. A worsening status is a regression, ordered from best to worst as `pass`, `warning`, `fail`, `error`. When status does not worsen and both reports contain a pass rate, a drop strictly greater than the threshold produces a warning. Unmatched suites and tests are ignored, including removed tests.

You can also call `ripple.compareBaseline(baseline, current)` directly; it returns `{ regressions, warnings }`. Comparisons do not change process state or write files.

## Development

```bash
npm test
npm run test:typecheck
npm run build
```

The tests exercise the source API, including independent resources for retries and trials, cancellation, late results, cleanup, configuration, and in-memory baseline comparison. Node.js-based development tooling is separate from the library's runtime requirements.
