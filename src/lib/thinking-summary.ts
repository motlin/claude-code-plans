import {stripHiddenChars} from "./hidden-chars";

/** Upstream's `Ek`: the summary line's cut, in UTF-16 units. */
const SUMMARY_MAX = 200;
const FENCE_LINE = /^```[\w-]*\s*$/;
const HEADING_MARKER = /^#{1,6}\s+/;
const LIST_MARKER = /^(?:[-*+]|\d{1,3}\.)\s+/;
const QUOTE_MARKER = /^>\s*/;
const LINK = /\[([^\]]*)\]\([^)\s]*\)/g;
const CODE_AND_EMPHASIS = /[`*]+/g;

/** Upstream's `Q2`: one line with its markdown markers stripped, or "" when nothing visible is left. */
function cleanLine(line: string): string
{
	const cleaned = line
		.trim()
		.replace(FENCE_LINE, "")
		.replace(HEADING_MARKER, "")
		.replace(LIST_MARKER, "")
		.replace(QUOTE_MARKER, "")
		.replace(LINK, "$1")
		.replace(CODE_AND_EMPHASIS, "")
		.trim();
	return stripHiddenChars(cleaned).trim() === "" ? "" : cleaned;
}

/** Upstream's `wZ`: cut past 200 units, dropping a dangling high surrogate, and end with an ellipsis. */
function cutSummary(line: string): string
{
	if (line.length <= SUMMARY_MAX) return line;
	let cut = line.slice(0, SUMMARY_MAX);
	const last = cut.charCodeAt(cut.length - 1);
	if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
	return `${cut}…`;
}

/**
 * Upstream's `k$` (shared-38): a thinking block's summary line, the first line (split on `\n` only) with
 * visible content once its markdown markers go, cut to 200 units. Undefined when no line has content.
 */
export function thinkingSummary(text: string): string | undefined
{
	for (const line of text.split("\n"))
	{
		const cleaned = cleanLine(line);
		if (cleaned !== "") return cutSummary(cleaned);
	}
	return undefined;
}

/** Upstream's `kN`: the thinking step's label, its summary line or "Thinking…". */
export function thinkingStepLabel(text: string): string
{
	return thinkingSummary(text) ?? "Thinking…";
}
