import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {createSlicer, DEFAULT_SLICE_MS, runCooperatively, type Slicer} from "./cooperative";
import type * as schema from "./db/schema";
import {extractSessionFiles, type SessionFiles} from "./session-files";
import {collectSessionLinks, type CollectedLink} from "./session-links";
import {parseTranscriptLine, transcriptFilePath} from "./structured-transcript";
import {processTranscriptSteps} from "./transcript";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * The whole session's files and links, as opposed to the window's.
 *
 * The transcript endpoint serves only a tail (see structured-transcript.ts), so
 * the extraction the browser runs over what it holds can only ever report a
 * floor -- `12+`. Opening a drawer asks for this instead: one pass over the
 * entire JSONL. On a 400 MB session that is seconds of CPU, so the scan is
 * time-sliced and memoized (see `readSessionResources`). Worth paying once, on
 * demand, for an inventory the reader can trust.
 *
 * Links come back uncategorized: `categorizeUrl` depends on the serving host
 * and the reader's own rules, so the browser groups them (`groupSessionLinks`).
 */
export interface SessionResources {
	files: SessionFiles;
	links: CollectedLink[];
}

function emptyResources(homeRoot: string): SessionResources {
	return {files: extractSessionFiles([], homeRoot), links: []};
}

export interface ScanOptions {
	/** How long the scan may hold the event loop before handing it back. */
	sliceMs?: number;
}

/** Read buffer size; each chunk arrives on its own event-loop turn. */
const READ_CHUNK_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;

/** Finished scans kept for reopened panes and other tabs, oldest evicted first. */
const MEMO_LIMIT = 8;
const memo = new Map<string, SessionResources>();
const inFlight = new Map<string, Promise<SessionResources>>();

/**
 * The scan for session `id`, memoized per (path, size, mtime) and shared between
 * concurrent callers.
 *
 * A 400 MB transcript takes seconds to read, parse and process, so the work is
 * time-sliced (`runCooperatively`): requests that arrive meanwhile -- the
 * `/api/file` the reader is waiting on -- are served between slices instead of
 * queueing behind the whole scan.
 */
export async function readSessionResources(
	db: IndexDb,
	id: string,
	homeRoot: string,
	options: ScanOptions = {},
): Promise<SessionResources> {
	const filePath = transcriptFilePath(db, id);
	if (!filePath) return emptyResources(homeRoot);

	let size: number;
	let mtimeMs: number;
	try {
		({size, mtimeMs} = await stat(filePath));
	} catch {
		return emptyResources(homeRoot);
	}

	const key = JSON.stringify([filePath, size, mtimeMs, homeRoot]);
	const cached = memo.get(key);
	if (cached !== undefined) {
		memo.delete(key);
		memo.set(key, cached);
		return cached;
	}
	const pending = inFlight.get(key);
	if (pending !== undefined) return pending;

	const scan = scanFile(filePath, size, homeRoot, createSlicer(options.sliceMs ?? DEFAULT_SLICE_MS))
		.then((resources) => {
			memo.set(key, resources);
			for (const oldest of memo.keys()) {
				if (memo.size <= MEMO_LIMIT) break;
				memo.delete(oldest);
			}
			return resources;
		})
		.finally(() => inFlight.delete(key));
	inFlight.set(key, scan);
	return scan;
}

async function scanFile(filePath: string, size: number, homeRoot: string, slicer: Slicer): Promise<SessionResources> {
	let records: Record<string, unknown>[];
	try {
		records = await readRecords(filePath, size, slicer);
	} catch {
		return emptyResources(homeRoot);
	}

	// Record 0 is the file's first record, so every occurrence's `anchorIndex` is
	// session-absolute and comparable with the transcript window's `startIndex`.
	const {lines} = await runCooperatively(processTranscriptSteps(records, 0), slicer);
	return {
		files: extractSessionFiles(lines, homeRoot),
		links: collectSessionLinks(lines),
	};
}

/**
 * The file's first `size` bytes as records, read in chunks and parsed with
 * pauses. Stopping at the stat'd size keeps the result consistent with the memo
 * key while the session is still appending.
 */
async function readRecords(filePath: string, size: number, slicer: Slicer): Promise<Record<string, unknown>[]> {
	const records: Record<string, unknown>[] = [];
	if (size === 0) return records;

	const parseLine = (buffer: Buffer, start: number, end: number): void => {
		const line = buffer.toString("utf8", start, end);
		if (!line.trim()) return;
		const record = parseTranscriptLine(line);
		if (record) records.push(record);
	};

	let carry: Buffer | undefined;
	const stream = createReadStream(filePath, {start: 0, end: size - 1, highWaterMark: READ_CHUNK_BYTES});
	for await (const chunk of stream as AsyncIterable<Buffer>) {
		const buffer: Buffer = carry === undefined ? chunk : Buffer.concat([carry, chunk]);
		let position = 0;
		for (;;) {
			const newline = buffer.indexOf(NEWLINE, position);
			if (newline === -1) break;
			parseLine(buffer, position, newline);
			position = newline + 1;
			if (slicer.due()) await slicer.pause();
		}
		carry = position < buffer.length ? buffer.subarray(position) : undefined;
	}
	if (carry !== undefined) parseLine(carry, 0, carry.length);
	return records;
}
