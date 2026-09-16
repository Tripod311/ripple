import type { EvalTarget, EvalTargetFactory } from "./evalTarget.js";
import type { Judge, JudgeFactory } from "./judge.js";
import type { EvalInteraction, EvalTestResult } from "./run.js";

export default class EvalContext<
	Input = unknown,
	Output = unknown,
	Snapshot = unknown
> {
	private abortController = new AbortController();
	private target!: EvalTarget<Input, Output, Snapshot>;
	private judge!: Judge;

	public interactions: EvalInteraction<Input, Output>[] = [];

	async dispose () {
		this.abort();
		await this.target.dispose();
		await this.judge.dispose();
	}

	async init (
		targetFactory: EvalTargetFactory<Input, Output, Snapshot>,
		judgeFactory: JudgeFactory
	) {
		this.target = await targetFactory();;
		this.judge = await judgeFactory();
	}

	async send(input: Input): Promise<Output> {
		if (this.abortController.signal.aborted) throw new Error("Aborted");
		const output = await this.target.send(input, this.abortController.signal);
		if (this.abortController.signal.aborted) throw new Error("Aborted");

		this.interactions.push({
			input,
			output
		});

		return output;
	}

	async snapshot(): Promise<Snapshot> {
		if (this.abortController.signal.aborted) throw new Error("Aborted");
		const result = await this.target.snapshot(this.abortController.signal);
		if (this.abortController.signal.aborted) throw new Error("Aborted");
		return result;
	}

	async evaluate(criteria: string, metadata?: Record<string, unknown>): Promise<EvalTestResult> {
		if (this.abortController.signal.aborted) throw new Error("Aborted");
		const result = await this.judge.evaluate({
			criteria: criteria,
			interactions: this.interactions,
			metadata: metadata
		}, this.abortController.signal);
		if (this.abortController.signal.aborted) throw new Error("Aborted");
		return result
	}

	abort () {
		this.abortController.abort();
	}
}