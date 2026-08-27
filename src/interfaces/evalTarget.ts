export interface EvalTarget<
	Input = unknown,
	Output = unknown,
	Snapshot = unknown
> {
	send(input: Input): Promise<Output>;

	reset(): Promise<void>;
	dispose(): Promise<void>;

	snapshot(): Promise<Snapshot>;
}

export type EvalTargetFactory<
	Input = unknown,
	Output = unknown,
	Snapshot = unknown
> = () => Promise<EvalTarget<Input, Output, Snapshot>>;