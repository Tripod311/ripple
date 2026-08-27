export type EvalStatus =
	| "pass"
	| "fail"
	| "warning"
	| "error";

export interface EvalTestResult {
	status: EvalStatus;
	details?: string | undefined;
	agreement?: number | undefined;
	results?: EvalTestResult[] | undefined;
}

export interface EvalInteraction<Input = unknown, Output = unknown> {
	input: Input;
	output: Output;
}

export interface EvalTestRunResult {
	name: string;
	duration?: number;
	result: EvalTestResult;
}

export interface EvalSuiteRunResult {
	name: string;
	description?: string;

	result: {
		total: number;
		passed: number;
		failed: number;
		warnings: number;
		errors: number;

		tests: Record<string, EvalTestRunResult>;
	};
}

export interface EvalRunResult {
	result: {
		total: number;
		passed: number;
		failed: number;
		warnings: number;
		errors: number;
	};

	suites: EvalSuiteRunResult[];

	fingerprint?: string | undefined;
}

export {}