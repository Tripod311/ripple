import fs from "node:fs"
import { pathToFileURL } from "node:url";
import path from "node:path"
import { glob } from "glob";
import type { RippleConfiguration } from "./interfaces/config.js"
import type { EvalSuite, EvalTest } from "./interfaces/suite.js"
import type { Judge } from "./interfaces/judge.js"
import type {
	EvalStatus,
	EvalTestResult,
	EvalTestRunResult,
	EvalSuiteRunResult,
	EvalRunResult
} from "./interfaces/run.js"
import EvalContext from "./interfaces/context.js"

export default class Ripple {
	private configuration: RippleConfiguration;
	private suites: EvalSuite[] = [];
	private judge?: Judge;

	constructor (configuration: RippleConfiguration) {
		this.configuration = configuration;
	}

	async loadSuites() {
		const patterns = this.configuration.execution.in;

		for (const currentPattern of patterns) {
			const files = await glob(currentPattern, {
				absolute: true
			});
			files.sort();

			for (const filePath of files) {
				const mod = await import(
					pathToFileURL(path.resolve(filePath)).href
				);

				this.suites.push(mod.default);
			}
		}
	}

	async run () {
		// run beforeAll hook

		if (this.configuration.hooks !== undefined) {
			if (this.configuration.hooks.beforeAll !== undefined) {
				await this.configuration.hooks?.beforeAll(this.configuration);
			}
		}

		// load suites

		await this.loadSuites();

		// spawn judge
		if (this.configuration.judgeFactory) {
			this.judge = await this.configuration.judgeFactory();
		}

		// load baseline to compare
		let baseline: EvalRunResult | undefined = undefined;

		if (this.configuration.execution.baseline !== undefined) {
			try {
				const baselineRaw = await fs.promises.readFile(this.configuration.execution.baseline, "utf-8");
				baseline = JSON.parse(baselineRaw);
			} catch (err: any) {
				console.error(`Failed to load baseline: ${err}`);
				return
			}
		}

		// run tests
		const result: EvalRunResult = {
			result: {
				total: this.suites.reduce((acc, suite) => { return acc + Object.keys(suite.tests).length }, 0),
				passed: 0,
				failed: 0,
				warnings: 0,
				errors: 0
			},

			suites: []
		}

		for (const suite of this.suites) {
			const suiteResult = await this.runSuite(suite);

			result.suites.push(suiteResult);

			result.result.passed += suiteResult.result.passed;
			result.result.failed += suiteResult.result.failed;
			result.result.warnings += suiteResult.result.warnings;
			result.result.errors += suiteResult.result.errors;
		}

		// save result

		if (this.configuration.execution.out !== undefined) {
			await this.saveResult(result);
		}

		// compare to baseline

		if (baseline !== undefined) {
			const { regressions, warnings } = this.compareBaseline(baseline, result);

			if (warnings.length === 0 && regressions.length === 0) {
				console.log(`All tests matched the baseline.`);
			} else {
				console.log(`Differences from the baseline were detected.`);
			}

			if (warnings.length > 0) {
				console.log(`Detected following warnings:\n${warnings.join('\n')}`);
			}

			if (regressions.length > 0) {
				console.log(`Detected following regressions:\n${regressions.join('\n')}`);

				if (this.configuration.execution.failOnRegression) process.exitCode = 1;
			}
		}

		// dispose judge
		try {
			if (this.judge !== undefined) {
				await this.judge!.dispose();
			}
		} catch (err: any) {
			console.log(`Error on judge dispose: ${err}`);
		}
	}

	async runSuite(suite: EvalSuite): Promise<EvalSuiteRunResult> {
		console.log(`\nRunning suite: ${suite.name}`);

		const target = await this.configuration.targetFactory();
		const context = new EvalContext(target, this.judge!);

		const suiteResult: EvalSuiteRunResult = {
			name: suite.name,
			description: suite.description,

			result: {
				total: Object.keys(suite.tests).length,
				passed: 0,
				failed: 0,
				warnings: 0,
				errors: 0,
				tests: {}
			}
		};

		try {
			for (const [testName, test] of Object.entries(suite.tests)) {
				await context.reset();

				const testResult = await this.runTest(
					testName,
					test,
					context
				);

				suiteResult.result.tests[testName] = testResult;

				switch (testResult.result.status) {
					case "pass":
						suiteResult.result.passed++;
						break;
					case "fail":
						suiteResult.result.failed++;
						break;
					case "warning":
						suiteResult.result.warnings++;
						break;
					case "error":
						suiteResult.result.errors++;
						break;
				}

				if (testResult.result.results !== undefined) {
					console.log(
						`${testResult.result.status.toUpperCase()} ${testName} ` +
						`(passRate: ${testResult.result.passRate?.toFixed(2) ?? "n/a"})`
					);

					for (let i = 0; i < testResult.result.results.length; i++) {
						const trial = testResult.result.results[i];

						console.log(
							`  [${i + 1}] ${trial!.status.toUpperCase()}` +
							(trial!.details
								? ` — ${trial!.details}`
								: "")
						);
						// skip line for readability
						console.log("");
					}
				} else {
					console.log(
						`${testResult.result.status.toUpperCase()} ${testName}` +
						(testResult.result.details
							? ` — ${testResult.result.details}`
							: "")
					);
					// skip line for readability
					console.log("");
				}
			}
		} finally {
			await target.dispose();
		}

		return suiteResult;
	}

	async runTest(
		name: string,
		test: EvalTest,
		context: EvalContext
	): Promise<EvalTestRunResult> {
		const startedAt = performance.now();

		const trials =
			typeof test === "function"
				? 1
				: test.trials;

		const results: EvalTestResult[] = [];

		for (let trial = 0; trial < trials; trial++) {
			if (trial > 0) {
				await context.reset();
			}

			const result = await this.executeTest(
				test,
				context
			);

			results.push(result);
		}

		if (trials === 1) {
			return {
				name,
				duration: performance.now() - startedAt,
				result: results[0]!
			};
		}

		const passed = results.filter(
			result => result.status === "pass"
		).length;

		const passRate = passed / trials;

		return {
			name,
			duration: performance.now() - startedAt,

			result: {
				status:
					passRate > 0.5
						? "pass"
						: "fail",

				passRate,
				results
			}
		};
	}

	private async executeTest(
		test: EvalTest,
		context: EvalContext
	): Promise<EvalTestResult> {
		const retries =
			this.configuration.execution.retries ?? 0;

		let lastError: unknown;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				if (attempt > 0) {
					await context.reset();
				}

				const execute = async () => {
					if (typeof test === "function") {
						return await test(context);
					}

					return await test.run(context);
				};

				const timeout =
					this.configuration.execution.timeout;

				if (timeout === undefined) {
					return await execute();
				}

				let timer: ReturnType<typeof setTimeout> | undefined;

				const timeoutPromise = new Promise<never>((_, reject) => {
				    timer = setTimeout(() => {
				        reject(
				            new Error(`Test timed out after ${timeout}ms`)
				        );
				    }, timeout);

				    timer.unref?.();
				});

				try {
				    return await Promise.race([
				        execute(),
				        timeoutPromise
				    ]);
				} finally {
				    if (timer !== undefined) {
				        clearTimeout(timer);
				    }
				}
			} catch (err) {
				lastError = err;
			}
		}

		return {
			status: "error",
			details:
				lastError instanceof Error
					? lastError.message
					: String(lastError)
		};
	}

	async saveResult(result: EvalRunResult): Promise<void> {
		result.fingerprint = this.configuration.fingerprint;
		const out = this.configuration.execution.out;

		if (out === undefined) {
			return;
		}

		await fs.promises.mkdir(out, {
			recursive: true
		});

		const timestamp = new Date()
			.toISOString()
			.replace(/[:.]/g, "-");

		const filePath = path.join(
			out,
			`result-${timestamp}.json`
		);

		await fs.promises.writeFile(
			filePath,
			JSON.stringify(result, null, 2),
			"utf-8"
		);

		console.log(`\nResult saved to ${filePath}`);
	}

	compareBaseline(
		baseline: EvalRunResult,
		current: EvalRunResult
	): { regressions: string[]; warnings: string[]; } {
		const regressions: string[] = [];
		const warnings: string[] = [];

		const severity: Record<EvalStatus, number> = {
			pass: 0,
			warning: 1,
			fail: 2,
			error: 3
		};

		const baselineSuites = new Map(
			baseline.suites.map(
				suite => [suite.name, suite]
			)
		);

		for (const currentSuite of current.suites) {
			const baselineSuite =
				baselineSuites.get(currentSuite.name);

			if (!baselineSuite) {
				continue;
			}

			for (
				const [testName, currentTest]
				of Object.entries(currentSuite.result.tests)
			) {
				const baselineTest =
					baselineSuite.result.tests[testName];

				if (!baselineTest) {
					continue;
				}

				const previousStatus =
					baselineTest.result.status;

				const currentStatus =
					currentTest.result.status;

				if (severity[currentStatus] > severity[previousStatus]) {
					regressions.push(
						`${currentSuite.name} -> ${testName}: ` +
						`${previousStatus} -> ${currentStatus}`
					);
				} else {
					if (baselineTest.result.passRate !== undefined && currentTest.result.passRate !== undefined) {
						if (currentTest.result.passRate < baselineTest.result.passRate - this.configuration.execution.passRate_warning_threshold!) {
							warnings.push(`${currentSuite.name} -> ${testName}: passRate ${baselineTest.result.passRate} -> ${currentTest.result.passRate}`)
						}
					}
				}
			}
		}

		return {
			regressions,
			warnings
		};
	}
}