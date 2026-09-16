export interface EvalTarget<
	Input = unknown,
	Output = unknown,
	Snapshot = unknown
> {
	send(input: Input, signal: AbortSignal): Promise<Output>;

	dispose(): Promise<void>;

	snapshot(signal: AbortSignal): Promise<Snapshot>;
}

export type EvalTargetFactory<
	Input = unknown,
	Output = unknown,
	Snapshot = unknown
> = () => Promise<EvalTarget<Input, Output, Snapshot>>;