import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {eq} from "drizzle-orm";
import {createHash} from "node:crypto";
import {closeSync} from "node:fs";
import * as schema from "./db/schema";
import {getSubagentById} from "./db/queries";
import type {AbandonedCut} from "./transcript-chain";
import
{
	lineEnd,
	lineStart,
	openTranscriptFile,
	readTranscriptLines,
	type OpenTranscriptFile,
	type TranscriptFileIndex,
} from "./transcript-file-index";
import type {TranscriptCut} from "./api/sessions";
import type {ClaudeChapterEntry} from "./session-chapters";
import type {GoalStatusRow} from "./session-goal";

export {parseTranscriptLine} from "./transcript-file-index";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Budget for one transcript window.
 *
 * A long session's JSONL runs to megabytes -- one measured session was 5 MB in
 * a single response -- and the browser cannot paint a message until the whole
 * body has arrived. So the endpoint serves the tail of the file, which is what
 * the reader wants to see first, and the client pages backwards with `before`.
 * The two caps work together: the byte budget keeps the response small when a
 * few tool results dominate, the record cap keeps the DOM small when the tail
 * is thousands of tiny records.
 */
export const TRANSCRIPT_WINDOW_MAX_BYTES = 512 * 1024;
export const TRANSCRIPT_WINDOW_MAX_RECORDS = 400;

export interface StructuredTranscript
{
	records: Record<string, unknown>[];
	byteOffset: number;
	/** Index of `records[0]` within the session's full JSONL record list. */
	startIndex: number;
	/**
	 * Countable messages (see message-count.ts) in the records before
	 * `startIndex`. Message positions are shared with the viewed-state counter
	 * and the session list, so a windowed transcript still has to report where
	 * its first record sits in the session's message numbering.
	 */
	precedingMessageCount: number;
	/** Uuids of this window's records that sit on an abandoned branch (transcript-chain.ts). */
	hiddenUuids: string[];
	/** The cuts whose replacement prompt is inside this window. */
	cuts: TranscriptCut[];
	/** See `transcriptChainVersion`. */
	chainVersion: string;
	/** Claude's chapters across the whole file, not just this window, minus those on abandoned branches. */
	chapters: ClaudeChapterEntry[];
	/** The whole file's `goal_status` rows (session-goal.ts), minus those on abandoned branches. */
	goalRows: GoalStatusRow[];
}

export interface TranscriptWindowOptions
{
	/** Exclusive upper bound: the window ends just before this record index. */
	before?: number | undefined;
	maxBytes?: number | undefined;
	maxRecords?: number | undefined;
}

/**
 * Identifies which branches the whole file's chain hides. It hashes the cuts
 * and retracted uuids, not the leaf, because the leaf moves on every appended
 * line while the hidden set only changes when a prompt forks the chain, the
 * leaf switches branch, or a record retracts rows: a client comparing versions
 * should replace its pages only then.
 */
export function transcriptChainVersion(cuts: readonly AbandonedCut[], retracted: readonly string[] = []): string
{
	const keys = [
		...cuts.map((cut) => `${cut.parentUuid}>${cut.abandonedUuid}`),
		...retracted.map((uuid) => `x${uuid}`),
	].toSorted();
	return createHash("sha1").update(keys.join("\n")).digest("hex").slice(0, 16);
}

const EMPTY_TRANSCRIPT: StructuredTranscript =
{
	records: [],
	byteOffset: 0,
	startIndex: 0,
	precedingMessageCount: 0,
	hiddenUuids: [],
	cuts: [],
	chainVersion: transcriptChainVersion([]),
	chapters: [],
	goalRows: [],
};

/**
 * Walk backwards from `end` while the window still fits both budgets. Always
 * yields at least one record: a single record over the byte budget is still
 * better than an empty transcript. Hidden lines cost bytes, since they are
 * still served, but not records: the record cap is about what the reader sees,
 * and a page made mostly of an abandoned branch would otherwise paint nearly
 * empty.
 */
function findWindowStart(index: TranscriptFileIndex, end: number, maxBytes: number, maxRecords: number)
{
	let start = end;
	let bytes = 0;
	let visible = 0;
	while (start > 0)
	{
		const size = lineEnd(index, start - 1) - lineStart(index, start - 1) + 1;
		const isHidden = index.hidden[start - 1] === true;
		if (start < end && (bytes + size > maxBytes || visible >= maxRecords)) break;
		bytes += size;
		if (!isHidden) visible += 1;
		start -= 1;
	}
	return start;
}

function uuidOf(record: Record<string, unknown> | undefined): string | undefined
{
	const uuid = record?.["uuid"];
	return typeof uuid === "string" ? uuid : undefined;
}

/**
 * The JSONL backing an id, which names either a session or one of its
 * subagents. Both kinds are read through the same endpoints, so every reader of
 * a transcript file resolves its path here.
 */
export function transcriptFilePath(db: IndexDb, id: string): string | undefined
{
	const session = db
		.select(
			{
				filePath: schema.sessions.filePath,
			},
		)
		.from(schema.sessions)
		.where(eq(schema.sessions.id, id))
		.get();
	return session?.filePath ?? getSubagentById(db, id)?.filePath;
}

export function readStructuredTranscript(
	db: IndexDb,
	id: string,
	options: TranscriptWindowOptions = {},
): StructuredTranscript
{
	return (
		readWindow(db, id, options, (index) =>
			Math.max(0, Math.min(options.before ?? index.starts.length, index.starts.length)),
		) ?? EMPTY_TRANSCRIPT
	);
}

/**
 * The page of records ending just before the line carrying `beforeUuid`, or
 * undefined when the file no longer has that uuid (upstream's
 * `getTranscriptPage(id, beforeUuid)` answering `found: false`). The uuid is
 * resolved against the file as it is now, so a line the CLI removed above it
 * can't shift the page the way a stale record index would.
 */
export function readStructuredTranscriptBefore(
	db: IndexDb,
	id: string,
	beforeUuid: string,
	options: Omit<TranscriptWindowOptions, "before"> = {},
): StructuredTranscript | undefined
{
	return readWindow(db, id, options, (index) => index.uuidLines.get(beforeUuid));
}

/**
 * The window ending just before the line `resolveEnd` picks, or undefined when
 * the session is unknown, the file can't be read, or `resolveEnd` finds no line.
 */
function readWindow(
	db: IndexDb,
	id: string,
	options: Omit<TranscriptWindowOptions, "before">,
	resolveEnd: (index: TranscriptFileIndex) => number | undefined,
): StructuredTranscript | undefined
{
	const filePath = transcriptFilePath(db, id);
	if (!filePath) return undefined;

	const maxBytes = options.maxBytes ?? TRANSCRIPT_WINDOW_MAX_BYTES;
	const maxRecords = options.maxRecords ?? TRANSCRIPT_WINDOW_MAX_RECORDS;

	let file: OpenTranscriptFile | undefined;
	try
	{
		// The chain is computed over the whole file, so a branch whose fork point
		// or replacement lies outside this window is still known. The file index
		// caches it, so only the window's lines are parsed here.
		file = openTranscriptFile(filePath);
		const {index} = file;
		const end = resolveEnd(index);
		if (end === undefined) return undefined;
		const lineStartIndex = findWindowStart(index, end, maxBytes, maxRecords);

		const records: Record<string, unknown>[] = [];
		const hiddenUuids: string[] = [];
		const windowUuids = new Set<string>();
		for (const [offset, record] of readTranscriptLines(file, lineStartIndex, end).entries())
		{
			if (!record) continue;
			records.push(record);
			const uuid = uuidOf(record);
			if (uuid === undefined) continue;
			windowUuids.add(uuid);
			if (index.hidden[lineStartIndex + offset] === true) hiddenUuids.push(uuid);
		}
		// A line that doesn't parse is left out, so the window's indices are
		// counted back from `end`: the client keys every page by where it ends,
		// and the skipped line comes out of the start instead.
		const startIndex = end - records.length;
		const cuts: TranscriptCut[] = index.abandoned.cuts
			.filter((cut) => windowUuids.has(cut.replacementUuid))
			.map(({parentUuid, replacementUuid, at, count}) => (
			{
				parentUuid,
				replacementUuid,
				at,
				count,
			}));

		return {
			records,
			byteOffset: index.size,
			startIndex,
			precedingMessageCount: index.countableBefore[startIndex] ?? 0,
			hiddenUuids,
			cuts,
			chainVersion: transcriptChainVersion(index.abandoned.cuts, index.abandoned.retracted),
			chapters: index.chapters.filter((chapter) => index.hidden[chapter.recordIndex] !== true),
			goalRows: index.goalRows.filter(({recordIndex}) => index.hidden[recordIndex] !== true).map(({row}) => row),
		};
	}
	catch
	{
		return undefined;
	}
	finally
	{
		if (file !== undefined) closeSync(file.fd);
	}
}
