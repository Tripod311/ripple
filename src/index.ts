import { validateConfig } from "./interfaces/config.js"
import type { RippleConfiguration, RippleHooks } from "./interfaces/config.js"
import EvalContext from "./interfaces/context.js"
import type { EvalTarget, EvalTargetFactory } from "./interfaces/evalTarget.js"
import type { Judge, JudgeInput, JudgeFactory } from "./interfaces/judge.js"
import type {
	EvalStatus,
	EvalTestResult,
	EvalInteraction,
	EvalTestRunResult,
	EvalSuiteRunResult,
	EvalRunResult
} from "./interfaces/run.js"
import type {
	EvalTestFunction,
	EvalTest,
	EvalSuite
} from "./interfaces/suite.js"
import Ripple from "./ripple.js"

export {
	validateConfig,
	Ripple,
	EvalContext
}

export type {
	RippleConfiguration,
	RippleHooks,
	EvalTarget,
	EvalTargetFactory,
	Judge,
	JudgeInput,
	JudgeFactory,
	EvalStatus,
	EvalTestResult,
	EvalInteraction,
	EvalTestRunResult,
	EvalSuiteRunResult,
	EvalRunResult,
	EvalTestFunction,
	EvalTest,
	EvalSuite
}