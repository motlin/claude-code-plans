/**
 * Claude's chapter tool calls, which upstream claude.ai/code never draws as tool rows: a call
 * with a title becomes an inline `<h3 id="epitaxy-ch-…">` heading, one without a title vanishes,
 * and one whose result is an error (other than an interruption) draws as a lone failed tool row.
 */

/** Upstream's chapter tool names (`Je`). */
export const CHAPTER_TOOL_NAMES: ReadonlySet<string> = new Set(["mcp__ccd_session__mark_chapter", "MarkChapter"]);

export function isChapterTool(name: string): boolean {
	return CHAPTER_TOOL_NAMES.has(name);
}

export interface ClaudeChapter {
	id: string;
	title: string;
	summary?: string;
}

/** Upstream `z`: a non-string title reads as "", and a blank summary is left out. */
export function chapterFromInput(id: string, input: Record<string, unknown>): ClaudeChapter {
	const title = typeof input["title"] === "string" ? input["title"].trim() : "";
	const summary = typeof input["summary"] === "string" ? input["summary"].trim() : "";
	const chapter: ClaudeChapter = {id, title};
	if (summary !== "") chapter.summary = summary;
	return chapter;
}

export type ChapterDisposition = {kind: "heading"; chapter: ClaudeChapter} | {kind: "drop"} | {kind: "failedTool"};

/**
 * How a chapter call draws. An errored result that is not an interruption (`interrupted`, see
 * `isInterruptedToolResult`) removes the heading
 * and leaves a lone failed tool row (upstream `Ll` + `Rl`), checked before the title as in `Il`;
 * otherwise an empty title swallows the call and anything else is a heading.
 */
export function chapterDisposition(
	block: {id: string; name: string; input: Record<string, unknown>},
	result: {isError: boolean; interrupted?: boolean | undefined} | undefined,
): ChapterDisposition {
	if (result?.isError === true && result.interrupted !== true) return {kind: "failedTool"};
	const chapter = chapterFromInput(block.id, block.input);
	return chapter.title === "" ? {kind: "drop"} : {kind: "heading", chapter};
}
