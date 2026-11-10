import {z} from "zod";

import {chapterDisposition, isChapterTool, isInterruptedChapterResult} from "./chapter-tool";
import {asRecord} from "./narrow";

/**
 * One of Claude's chapters, from a chapter tool call anywhere in the session's JSONL: the
 * session outline lists them all, not just those in the loaded transcript window.
 */
export const ClaudeChapterEntrySchema = z.strictObject({
	/** The chapter call's tool_use id, which the heading's `epitaxy-ch-` anchor uses. */
	id: z.string(),
	title: z.string(),
	summary: z.string().optional(),
	/** The uuid of the assistant record holding the call. */
	uuid: z.string(),
	/** The record's session-absolute JSONL index. */
	recordIndex: z.number(),
});

export type ClaudeChapterEntry = z.infer<typeof ClaudeChapterEntrySchema>;

/** A tool_result's text: a string, or its text blocks joined by newlines (session-utils' `extractToolResultContent`, kept light for the client bundle). */
function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block: unknown) => {
			const record = asRecord(block);
			return record?.["type"] === "text" && typeof record["text"] === "string" ? [record["text"]] : [];
		})
		.join("\n");
}

function contentBlocks(record: Record<string, unknown>): Record<string, unknown>[] {
	const content = asRecord(record["message"])?.["content"];
	if (!Array.isArray(content)) return [];
	return content.flatMap((block: unknown) => {
		const record = asRecord(block);
		return record === undefined ? [] : [record];
	});
}

/**
 * Adds a record's chapters to `chapters` in place. A titled call adds a chapter (pending,
 * successful and interrupted calls alike); a result that fails it, other than an
 * interruption, removes it again, as upstream's `Ll` does.
 */
export function collectClaudeChapters(
	chapters: ClaudeChapterEntry[],
	record: Record<string, unknown> | undefined,
	recordIndex: number,
): void {
	const type = record?.["type"];
	if (record === undefined || (type !== "assistant" && type !== "user")) return;
	const uuid = typeof record["uuid"] === "string" ? record["uuid"] : "";
	for (const block of contentBlocks(record)) {
		if (type === "assistant" && block["type"] === "tool_use") {
			const {id, name} = block;
			if (typeof id !== "string" || typeof name !== "string" || !isChapterTool(name)) continue;
			const disposition = chapterDisposition({id, name, input: asRecord(block["input"]) ?? {}}, undefined);
			if (disposition.kind === "heading") chapters.push({...disposition.chapter, uuid, recordIndex});
		} else if (type === "user" && block["type"] === "tool_result" && block["is_error"] === true) {
			const index = chapters.findIndex((chapter) => chapter.id === block["tool_use_id"]);
			if (index !== -1 && !isInterruptedChapterResult(resultText(block["content"]))) chapters.splice(index, 1);
		}
	}
}

/** `existing` extended with the chapters in `records`, whose first record sits at `startIndex`. */
export function appendClaudeChapters(
	existing: readonly ClaudeChapterEntry[],
	records: readonly (Record<string, unknown> | undefined)[],
	startIndex: number,
): ClaudeChapterEntry[] {
	const chapters = [...existing];
	for (const [offset, record] of records.entries()) collectClaudeChapters(chapters, record, startIndex + offset);
	return chapters;
}

/** Every chapter in a whole session's records, in file order. */
export function extractClaudeChapters(records: readonly (Record<string, unknown> | undefined)[]): ClaudeChapterEntry[] {
	return appendClaudeChapters([], records, 0);
}
