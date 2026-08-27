import type { EvalTarget, EvalTargetFactory } from "./evalTarget.js"
import type { Judge, JudgeFactory } from "./judge.js"

export interface RippleHooks {
	beforeAll?: (conf: RippleConfiguration) => Promise<void>;
}

export interface RippleConfiguration {
	targetFactory: EvalTargetFactory;
	judgeFactory: JudgeFactory;
	fingerprint?: string | undefined;

	execution: {
		// what to run
		in: string[];
		// where to save result
		out?: string | undefined;
		// baseline to compare with
		baseline?: string | undefined;
		// exit 1 if regression detected
		failOnRegression?: boolean | undefined;
		// baseline agreement noise threshold
		agreement_warning_threshold?: number | undefined;
		// request/response options
		timeout?: number | undefined;
		retries?: number | undefined;
	};

	hooks?: RippleHooks | undefined;
}

export function validateConfig(conf: RippleConfiguration): RippleConfiguration {
	if (conf === undefined || conf === null) {
		throw new Error("Ripple configuration is not defined");
	}

	if (conf.targetFactory === undefined) {
		throw new Error("targetFactory is not defined");
	}

	if (conf.judgeFactory === undefined) {
		throw new Error("judgeFactory is not defined");
	}

	if (conf.execution === undefined) {
		throw new Error("execution configuration is not defined");
	}

	if (
		conf.execution.timeout !== undefined &&
		(!Number.isFinite(conf.execution.timeout) ||
			conf.execution.timeout <= 0)
	) {
		throw new Error("execution.timeout must be greater than 0");
	}

	if (
		conf.execution.retries !== undefined &&
		(!Number.isInteger(conf.execution.retries) ||
			conf.execution.retries < 0)
	) {
		throw new Error("execution.retries must be a non-negative integer");
	}

	return {
		targetFactory: conf.targetFactory,
		judgeFactory: conf.judgeFactory,

		execution: {
			in: conf.execution.in,
			out: conf.execution.out,
			baseline: conf.execution.baseline,
			failOnRegression: conf.execution.failOnRegression ?? false,
			agreement_warning_threshold: conf.execution.agreement_warning_threshold ?? 0.05,
			timeout: conf.execution.timeout,
			retries: conf.execution.retries
		},

		hooks: conf.hooks
	};
}

export {};