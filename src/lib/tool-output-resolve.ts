import {classifyToolBody, type ToolBodyKind} from "./tool-body-kind";
import type {ToolOutputNote, ToolOutputShape} from "./tool-output-shape";

/** A shape with its body classified by kind, ready to draw (upstream `l_` applies `o_` itself). */
export interface ResolvedToolOutput {
	status?: "waiting" | "empty";
	note?: ToolOutputNote;
	body?: ToolBodyKind;
	toldClaude?: string;
}

/**
 * Classify a shape's body by kind. `json` is the full pretty JSON the transcript kept for a result whose text was
 * cut (`ToolResultInfo.resultJson`); it stands in for a plain body only.
 */
export function resolveToolOutput(
	shape: ToolOutputShape,
	{allowMarkdown, json}: {allowMarkdown: boolean; json?: string | undefined},
): ResolvedToolOutput {
	if ("status" in shape) return {status: shape.status};
	const resolved: ResolvedToolOutput = {};
	if ("note" in shape) resolved.note = shape.note;
	if ("toldClaude" in shape) resolved.toldClaude = shape.toldClaude;
	if ("body" in shape) {
		const text = "note" in shape ? shape.body : (json ?? shape.body);
		resolved.body = classifyToolBody(text, {allowMarkdown});
	}
	return resolved;
}

/**
 * Upstream `J_`: what Copy takes for the output. The whole output for a preview, else the told-Claude text,
 * else the body as classified (pretty-printed for JSON).
 */
export function toolOutputCopyText(resolved: ResolvedToolOutput, output: string | undefined): string | undefined {
	const kind = resolved.note?.kind;
	if (kind === "preview" || kind === "cappedPreview") return output;
	return resolved.toldClaude ?? resolved.body?.text;
}
