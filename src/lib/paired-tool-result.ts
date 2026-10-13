import {asRecord, isRecord} from "./narrow";

export interface PairedResult {
	resultEntry: {raw: string; lineIndex: number; uuid?: string};
	resultLineIndex: number;
	toolUseId: string;
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/** The object content blocks of a raw JSONL record of `type`, or null when it is another record type or has none. */
function contentBlocks(raw: string, type: "assistant" | "user"): Array<Record<string, unknown>> | null {
	const record = asRecord(parseJson(raw));
	if (record?.["type"] !== type) return null;
	const content = asRecord(record["message"])?.["content"];
	return Array.isArray(content) ? content.filter(isRecord) : null;
}

/** Find the user record among `candidates` holding the tool_result for one of the focal assistant record's tool_use blocks. */
export function findPairedToolResult(
	focalRaw: string,
	candidates: Array<{raw: string; lineIndex: number; uuid?: string}>,
): PairedResult | null {
	const toolUseIds = (contentBlocks(focalRaw, "assistant") ?? []).flatMap((block) =>
		block["type"] === "tool_use" && typeof block["id"] === "string" ? [block["id"]] : [],
	);
	if (toolUseIds.length === 0) return null;

	for (const candidate of candidates) {
		for (const block of contentBlocks(candidate.raw, "user") ?? []) {
			const toolUseId = block["tool_use_id"];
			if (block["type"] === "tool_result" && typeof toolUseId === "string" && toolUseIds.includes(toolUseId)) {
				return {resultEntry: candidate, resultLineIndex: candidate.lineIndex, toolUseId};
			}
		}
	}
	return null;
}
