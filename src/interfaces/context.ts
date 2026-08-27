import type { EvalTarget } from "./evalTarget.js";
import type { Judge } from "./judge.js";
import type { EvalInteraction, EvalTestResult } from "./run.js";

export default class EvalContext<
	Input = unknown,
	Output = unknown,
	Snapshot = unknown
> {
	public target: EvalTarget<Input, Output, Snapshot>;
	public judge: Judge;

	public interactions: EvalInteraction<Input, Output>[] = [];

	constructor(
		target: EvalTarget<Input, Output, Snapshot>,
		judge: Judge
	) {
		this.target = target;
		this.judge = judge;
	}

	async send(input: Input): Promise<Output> {
		const output = await this.target.send(input);

		this.interactions.push({
			input,
			output
		});

		return output;
	}

	async snapshot(): Promise<Snapshot> {
		return await this.target.snapshot();
	}

	async reset(): Promise<void> {
		this.interactions = [];

		await this.target.reset();
	}

	async evaluate(criteria: string, metadata?: Record<string, unknown>): Promise<EvalTestResult> {
		return await this.judge.evaluate({
			criteria: criteria,
			interactions: this.interactions,
			metadata: metadata
		});
	}
}