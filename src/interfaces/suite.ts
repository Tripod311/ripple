import EvalContext from "./context.js"
import type { EvalTestResult } from "./run.js"
import type { EvalTarget } from "./evalTarget.js"

export type EvalTestFunction<
	Input = unknown,
	Output = unknown,
	Snapshot = unknown
> = (context: EvalContext<Input, Output, Snapshot>) => Promise<EvalTestResult>;

export type EvalTest<Input = unknown, Output = unknown, Snapshot = unknown> =
	| EvalTestFunction<Input, Output, Snapshot>
	| {
		run: EvalTestFunction<Input, Output, Snapshot>;
		trials: number;
	};

export interface EvalSuite<
	Input = unknown,
	Output = unknown,
	Snapshot = unknown
> {
	name: string;
	description: string;

	tests: Record<
		string,
		EvalTest<
			Input,
			Output,
			Snapshot
		>
	>;
}

export {};