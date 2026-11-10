import {z} from "zod";

import type {SessionChapters} from "./chapter-store";
import {chapterDisposition, isChapterTool} from "./chapter-tool";
import {isInterruptedToolResult} from "./tool-interruption";
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
	const blocks = contentBlocks(record);
	// Upstream reads the record's denial kind and toolUseResult only for its lone result.
	const lone = blocks.filter((block) => block["type"] === "tool_result").length === 1;
	const toolDenialKind = typeof record["toolDenialKind"] === "string" ? record["toolDenialKind"] : undefined;
	for (const block of blocks) {
		if (type === "assistant" && block["type"] === "tool_use") {
			const {id, name} = block;
			if (typeof id !== "string" || typeof name !== "string" || !isChapterTool(name)) continue;
			const disposition = chapterDisposition({id, name, input: asRecord(block["input"]) ?? {}}, undefined);
			if (disposition.kind === "heading") chapters.push({...disposition.chapter, uuid, recordIndex});
		} else if (type === "user" && block["type"] === "tool_result" && block["is_error"] === true) {
			const index = chapters.findIndex((chapter) => chapter.id === block["tool_use_id"]);
			const interrupted = isInterruptedToolResult({
				text: resultText(block["content"]),
				...(lone ? {toolUseResult: record["toolUseResult"], toolDenialKind} : {}),
			});
			if (index !== -1 && !interrupted) chapters.splice(index, 1);
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

/** The id of the outline's first row, which jumps to the top of the transcript (upstream's `GO`). */
const SESSION_START_CHAPTER_ID = "session-start";

/** The DOM id of a chapter's inline heading (upstream's `KO`). */
export function chapterAnchorId(id: string): string {
	return `epitaxy-ch-${id}`;
}

/** One row of the session outline: the session's start, one of Claude's chapters, or a message the user pinned. */
export interface SessionChapter {
	id: string;
	title: string;
	summary?: string;
	source: "session" | "claude" | "user";
	/** The record a jump lands on: the first entry, the chapter call's record, or the pinned message. */
	uuid: string;
	recordIndex: number;
}

/**
 * The session's outline (upstream's `lk`): Claude's chapters, minus the hidden ones and with renames
 * applied, merged with the user's pins in transcript order (a pin before a chapter on the same
 * record), under a Session start row whenever the transcript has a first entry.
 */
export function buildSessionChapters({
	claudeChapters,
	store,
	firstEntryUuid,
	sessionStartTitle,
}: {
	claudeChapters: readonly ClaudeChapterEntry[];
	store: SessionChapters;
	firstEntryUuid: string | undefined;
	sessionStartTitle: string;
}): SessionChapter[] {
	const hidden = new Set(store.hidden);
	const user = store.userChapters.map((chapter): SessionChapter => ({
		id: chapter.id,
		title: chapter.title,
		source: "user",
		uuid: chapter.afterId,
		recordIndex: chapter.recordIndex,
	}));
	const claude = claudeChapters
		.filter((chapter) => !hidden.has(chapter.id))
		.map((chapter): SessionChapter => ({
			id: chapter.id,
			title: store.renames[chapter.id] ?? chapter.title,
			...(chapter.summary === undefined ? {} : {summary: chapter.summary}),
			source: "claude",
			uuid: chapter.uuid,
			recordIndex: chapter.recordIndex,
		}));
	// A stable sort over pins-then-chapters keeps a pin ahead of a chapter on the same record.
	const chapters = [...user, ...claude].toSorted((a, b) => a.recordIndex - b.recordIndex);
	if (firstEntryUuid === undefined) return chapters;
	return [
		{
			id: SESSION_START_CHAPTER_ID,
			title: sessionStartTitle,
			source: "session",
			uuid: firstEntryUuid,
			recordIndex: 0,
		},
		...chapters,
	];
}

/** Upstream's outline gate (`uk`): at least one chapter that is not the session's own start. */
export function hasOutline(chapters: readonly SessionChapter[]): boolean {
	return chapters.some((chapter) => chapter.source !== "session");
}

/** Upstream's at-bottom slack: within this many pixels of the end, the last chapter is the active one. */
export const ACTIVE_CHAPTER_BOTTOM_SLACK_PIXELS = 8;

/**
 * The chapter being read (upstream's `OO`). At the bottom of a scrollable transcript it is the last
 * chapter. Otherwise it is the last chapter, walking in order, whose heading has reached the
 * reading line; the walk stops at the first heading still below it. Session start always counts,
 * and a chapter whose heading is not mounted counts when its record sits before the first visible
 * row (a pin also on it).
 */
export function pickActiveChapter(
	chapters: readonly SessionChapter[],
	{
		canScroll,
		distanceToBottomPx,
		viewportTopPx,
		firstVisibleRecordIndex,
		getAnchorTop,
	}: {
		canScroll: boolean;
		distanceToBottomPx: number;
		/** The reading line, in the same viewport coordinates as `getAnchorTop`. */
		viewportTopPx: number;
		/** The record index of the first row at or below the reading line, or -1 when no row is mounted. */
		firstVisibleRecordIndex: number;
		/** The top of the chapter's mounted heading, or null when it is not in the DOM. */
		getAnchorTop: (chapter: SessionChapter) => number | null;
	},
): string | null {
	if (canScroll && distanceToBottomPx <= ACTIVE_CHAPTER_BOTTOM_SLACK_PIXELS) return chapters.at(-1)?.id ?? null;
	let active: string | null = null;
	for (const chapter of chapters) {
		if (chapter.source === "session") {
			active = chapter.id;
			continue;
		}
		const top = getAnchorTop(chapter);
		if (top === null) {
			const before =
				chapter.source === "user"
					? chapter.recordIndex <= firstVisibleRecordIndex
					: chapter.recordIndex < firstVisibleRecordIndex;
			if (firstVisibleRecordIndex >= 0 && before) active = chapter.id;
			continue;
		}
		if (top <= viewportTopPx) active = chapter.id;
		else break;
	}
	return active;
}
