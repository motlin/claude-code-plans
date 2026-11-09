import type {ClientToolCall} from "../components/tool-renderers/types";

/** Upstream ChatToolCard's `resetOn`: a crashed card retries when its call moves to a later stage. */
export type ToolCardStage = "partial_input" | "input_settled" | "result";

type StageCall = Pick<ClientToolCall, "input" | "result" | "resultUuid">;

/** Any result, including an `is_error` one or a live failure that has no `resultUuid` yet. */
function hasResult(call: StageCall): boolean {
	return call.resultUuid !== undefined || call.result !== undefined;
}

/** Upstream `dh`: JSONL has no `buffered_input`, so only a non-empty input object is settled. */
function inputSettled(call: StageCall): boolean {
	const input: unknown = call.input;
	return typeof input === "object" && input !== null && Object.keys(input).length > 0;
}

function stage(result: boolean, settled: boolean): ToolCardStage {
	if (result) return "result";
	return settled ? "input_settled" : "partial_input";
}

/** Upstream `Vh`'s stage for one tool card. */
export function toolCardStage(call: StageCall): ToolCardStage {
	return stage(hasResult(call), inputSettled(call));
}

/** Upstream `t8`'s stage for a group: settled or finished only when every call is. */
export function toolGroupStage(calls: readonly StageCall[]): ToolCardStage {
	return stage(calls.every(hasResult), calls.every(inputSettled));
}
