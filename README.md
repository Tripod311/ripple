# Ripple

Lightweight, provider-agnostic eval and regression testing harness for LLM applications and AI agents.

Ripple is designed for testing existing AI applications without forcing them into a specific provider, agent framework, message format, or evaluation DSL.

Instead of owning your LLM stack, Ripple provides a small set of interfaces around it. You define how a test target and an optional judge are created using your application's existing classes, APIs, providers, or HTTP endpoints.

Tests themselves are plain JavaScript or TypeScript functions, so application-specific behavior can be tested directly without learning a separate configuration language.

## Why Ripple?

LLM applications are often difficult to regression-test with traditional assertions alone. Their behavior may be probabilistic, stateful, multi-turn, or dependent on another model acting as a judge.

Ripple provides:

* Plain JavaScript/TypeScript eval suites
* Integration with existing application code through small target and judge adapters
* Support for arbitrary target input, output, and snapshots
* Stateful and multi-turn test scenarios
* Optional LLM-as-a-judge evaluation
* Repeated trials with majority voting and agreement scores
* Automatic retries and timeouts
* `pass`, `fail`, `warning`, and `error` results
* Saved evaluation results
* Baseline comparison for regression testing
* Fingerprints for identifying the evaluated version
* Optional hooks for dynamically configuring a run

Ripple intentionally does not provide its own LLM provider abstraction.

Your application already knows how to communicate with its models. Ripple only needs to know how to call your target and judge.

This makes it possible to test an existing Node.js application directly through its own classes, or test an application written in another language through a small HTTP adapter.

## Installation

```bash
npm install @tripod311/ripple
```

## Basic usage

Create a Ripple configuration in your project.

```ts
import {
	Ripple,
	validateConfig
} from "@tripod311/ripple";

import type {
	EvalTarget,
	JudgeInput,
	RippleConfiguration
} from "@tripod311/ripple";

async function spawnTarget(): Promise<EvalTarget<string, string, unknown>> {
	// Create your existing agent, provider, application client, etc.
	const agent = createAgent();

	return {
		async send(input: string): Promise<string> {
			return await agent.send(input);
		},

		async reset(): Promise<void> {
			await agent.reset();
		},

		async dispose(): Promise<void> {
			// Close connections, subprocesses, local model servers, etc.
		},

		async snapshot(): Promise<unknown> {
			return agent.getState();
		}
	};
}

async function spawnJudge() {
	// The judge can use another model, the same model,
	// a local model, an API, or any other implementation.
	const judge = createJudge();

	return {
		async evaluate(input: JudgeInput) {
			return await judge.evaluate(
				input.criteria,
				input.metadata
			);
		},

		async dispose(): Promise<void> {
			// Clean up judge resources if necessary.
		}
	};
}

const config: RippleConfiguration = validateConfig({
	targetFactory: spawnTarget,
	judgeFactory: spawnJudge,

	// Optional identifier of the evaluated application/configuration.
	fingerprint: "my-agent-v1",

	execution: {
		// Glob patterns containing eval suites.
		in: [
			"./evals/*.js"
		],

		// Optional directory where JSON results are stored.
		out: "./eval-results",

		// Optional previous result used as a regression baseline.
		baseline: "./baseline.json",

		// Exit with code 1 when a regression is detected.
		failOnRegression: true,

		// Warn when agreement drops beyond this amount
		// while the final test status remains unchanged.
		agreement_warning_threshold: 0.2,

		// Maximum execution time for one test attempt.
		timeout: 30_000,

		// Number of retries after execution errors/timeouts.
		retries: 2
	},

	hooks: {
		// Optional hook executed before suites are loaded.
		// The configuration can be modified dynamically.
		async beforeAll(conf) {
			// Example:
			// conf.execution.in.push("./agents/daniel/evals/*.js");
		}
	}
});

const ripple = new Ripple(config);

await ripple.run();
```

Only `targetFactory`, `judgeFactory`, and `execution.in` are required by the configuration.

The remaining execution options are optional and can be omitted for a minimal run:

```ts
const config = validateConfig({
	targetFactory: spawnTarget,
	judgeFactory: spawnJudge,

	execution: {
		in: ["./evals/*.js"]
	}
});
```

## Eval suites

Eval suites are regular JavaScript or TypeScript modules.

A simple deterministic test can inspect application state directly:

```ts
export default {
	name: "basic_behavior",

	description: "Basic behavioral regression tests.",

	tests: {
		async neutral_greeting(ctx) {
			const before = await ctx.snapshot();

			await ctx.send("Hello, nice to meet you.");

			const after = await ctx.snapshot();

			if (before.state !== after.state) {
				return {
					status: "fail",
					details: "State changed after a neutral greeting"
				};
			}

			return {
				status: "pass"
			};
		}
	}
};
```

Because evals are ordinary JavaScript, they can use loops, conditions, fixtures, mock databases, helper functions, application classes, filesystem access, or anything else available to the project.

## Judge-based evals

Tests may also ask the configured judge to evaluate a conversation or result.

```ts
const criteria = `
PASS if the assistant remains cautious and does not disclose an exact amount.

WARNING if it reveals more information than expected but still avoids giving
a precise amount.

FAIL if it provides an exact amount.
`;

export default {
	name: "persona_behavior",

	tests: {
		financial_disclosure: {
			run: async function (ctx) {
				await ctx.send(
					"How much money exactly are you planning to invest?"
				);

				// metadata is optional
				return await ctx.evaluate(criteria, metadata);
			},

			trials: 3
		}
	}
};
```

Ripple records interactions made through the evaluation context. The judge implementation remains entirely application-defined, so it may use those interactions, custom metadata, existing conversation history, or another project-specific format.

## Multiple trials

LLM behavior is probabilistic, so a test can be executed multiple times:

```ts
{
	run: async function (ctx) {
		// ...
	},

	trials: 5
}
```

Each trial starts from a reset target state.

Ripple performs majority voting over the trial results and stores an `agreement` value between `0` and `1`.

For example, if four out of five trials pass:

```text
agreement = 0.8
```

A tie does not count as a pass.

Individual trial results are preserved in the final result for inspection.

## Results

Ripple tests use four statuses:

* `pass` — expected behavior
* `warning` — questionable behavior that should be reviewed but is not considered a failure
* `fail` — evaluation criteria were not met
* `error` — the evaluation could not be completed successfully

A result may also contain a human-readable `details` field.

When `execution.out` is configured, Ripple stores each run as a JSON result file.

## Regression baselines

A previous Ripple result can be used as a baseline:

```ts
execution: {
	in: ["./evals/*.js"],
	baseline: "./baseline.json"
}
```

Ripple compares current test statuses with the baseline and reports regressions when a test becomes worse.

Agreement changes can also be reported when repeated tests become less stable without changing their final status.

Set:

```ts
failOnRegression: true
```

to make Ripple exit with a non-zero status when a regression is detected, which allows it to be used in CI workflows.

Baselines are intended to represent an explicitly accepted version of the application's behavior rather than automatically becoming the result of the latest run.

## Dynamic configuration

Because Ripple configuration is executable JavaScript or TypeScript, projects can prepare evaluation runs dynamically.

For example, a project containing many agents can select one through `process.argv`, load its configuration, and append agent-specific suites:

```ts
async function beforeAll(conf: RippleConfiguration) {
	const agentName = process.argv[2];

	conf.execution.in.push(
		`./agents/${agentName}/evals/*.js`
	);

	conf.execution.out =
		`./agents/${agentName}/results`;
}
```

The same mechanism can be used to load models, personas, fixtures, environment-specific settings, or other project-specific data without introducing those concepts into Ripple itself.

## Design philosophy

Ripple tries to provide orchestration rather than ownership.

The framework knows how to:

* Load eval suites
* Create evaluation targets
* Execute tests
* Reset state between tests and trials
* Invoke judges
* Retry failed executions
* Aggregate repeated trials
* Save results
* Compare runs against baselines

It deliberately does not define:

* Which LLM provider to use
* How prompts are structured
* How conversation history is stored
* How an agent is implemented
* What application state looks like
* Which model acts as the judge
* How external services should be mocked
* How project-specific behavior should be evaluated

Those decisions remain ordinary application code.

The goal is to make Ripple easy to attach to an existing AI application without restructuring the application around the evaluation framework.
