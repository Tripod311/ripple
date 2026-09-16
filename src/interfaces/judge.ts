import type { EvalTestResult, EvalInteraction } from "./run.js"

export interface JudgeInput {
	criteria: string;

	interactions?: EvalInteraction[];

	metadata?: Record<string, unknown> | undefined;
}

export interface Judge {
	evaluate(input: JudgeInput, signal: AbortSignal): Promise<EvalTestResult>;

	dispose(): Promise<void>;
}

export type JudgeFactory = () => Promise<Judge>;

export {}