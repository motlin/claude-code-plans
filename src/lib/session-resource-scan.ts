import {eq} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {createReadStream} from "node:fs";
import {open, stat} from "node:fs/promises";
import {createSlicer, DEFAULT_SLICE_MS, runCooperatively, type Slicer} from "./cooperative";
import {SessionResourcesResponse} from "./api/sessions";
import {CooperativeQueue} from "./cooperative-queue";
import {retryWhileBusy} from "./db/busy";
import * as schema from "./db/schema";
import {JsonlRecordSchema} from "./runtime-schemas";
import {extractSessionFiles, type SessionFiles} from "./session-files";
import {collectSessionLinks, type CollectedLink} from "./session-links";
import {parseTranscriptLine, transcriptFilePath} from "./structured-transcript";
import {processTranscriptSteps, type SessionLine} from "./transcript";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * The whole session's files and links, as opposed to the window's.
 *
 * The transcript endpoint serves only a tail (see structured-transcript.ts), so
 * the extraction the browser runs over what it holds can only ever report a
 * floor -- `12+`. Opening a drawer asks for this instead: one pass over the
 * entire JSONL. On a 400 MB session that is seconds of CPU and hundreds of MB
 * of parsed records, so the scan skips the records that cannot matter, runs
 * one at a time, is time-sliced, and its result is memoized and stored (see
 * `readSessionResources`). Worth paying once, on demand, for an inventory the
 * reader can trust.
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

/**
 * Bump whenever the scan's output for the same bytes changes, so results stored
 * by an older build stop answering.
 */
const SCAN_VERSION = 1;

/** Finished scans kept for reopened panes and other tabs, oldest evicted first. */
const MEMO_LIMIT = 8;
const memo = new Map<string, SessionResources>();
const inFlight = new Map<string, Promise<SessionResources>>();

/**
 * Cold scans run one at a time. Each holds a whole transcript's processed
 * lines, and several 400 MB sessions scanning at once ran the server out of
 * heap. A job is keyed by file, not by size: a live session that grows while
 * its scan waits gets one scan of its newest bytes, not one per size asked for.
 */
let coldScans = new CooperativeQueue(0);
/** Per file, what its last cold scan found, for the callers that waited on it; capped like `memo`. */
const lastColdScan = new Map<string, SessionResources>();

let running = 0;

/** How many cold scans are reading and processing a transcript right now: never more than one. */
export function coldScansRunning(): number {
	return running;
}

/** Drop the in-memory memo, as a server restart does. Stored scans survive. */
export function forgetScannedResources(): void {
	memo.clear();
	inFlight.clear();
	lastColdScan.clear();
	coldScans = new CooperativeQueue(0);
}

function remember(key: string, resources: SessionResources): void {
	memo.set(key, resources);
	for (const oldest of memo.keys()) {
		if (memo.size <= MEMO_LIMIT) break;
		memo.delete(oldest);
	}
}

function memoKey(filePath: string, size: number, mtimeMs: number, homeRoot: string): string {
	return JSON.stringify([filePath, size, mtimeMs, homeRoot]);
}

/**
 * Scan `filePath` as it stands when the job runs, which can be newer than when
 * it was asked for, unless that version is already memoized or stored.
 */
async function coldScan(db: IndexDb, filePath: string, homeRoot: string, sliceMs: number): Promise<SessionResources> {
	const fileKey = JSON.stringify([filePath, homeRoot]);
	await coldScans.enqueue(fileKey, async () => {
		const {size, mtimeMs} = await stat(filePath);
		const key = memoKey(filePath, size, mtimeMs, homeRoot);
		let resources = memo.get(key) ?? readStoredScan(db, filePath, homeRoot, size, mtimeMs);
		if (resources === undefined) {
			running++;
			try {
				resources = await scanFile(filePath, size, homeRoot, createSlicer(sliceMs));
			} finally {
				running--;
			}
			storeScan(db, filePath, homeRoot, size, mtimeMs, resources);
		}
		remember(key, resources);
		lastColdScan.delete(fileKey);
		lastColdScan.set(fileKey, resources);
		for (const oldest of lastColdScan.keys()) {
			if (lastColdScan.size <= MEMO_LIMIT) break;
			lastColdScan.delete(oldest);
		}
	});
	return lastColdScan.get(fileKey) ?? emptyResources(homeRoot);
}

/**
 * The scan for session `id`, memoized per (path, size, mtime) and shared between
 * concurrent callers.
 *
 * A 400 MB transcript takes seconds to read, parse and process, so the work is
 * time-sliced (`runCooperatively`): requests that arrive meanwhile -- the
 * `/api/file` the reader is waiting on -- are served between slices instead of
 * queueing behind the whole scan. The result is also stored in index.db, so a
 * restarted server answers an unchanged file without scanning it again.
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

	const key = memoKey(filePath, size, mtimeMs, homeRoot);
	const cached = memo.get(key);
	if (cached !== undefined) {
		memo.delete(key);
		memo.set(key, cached);
		return cached;
	}
	const pending = inFlight.get(key);
	if (pending !== undefined) return pending;

	const stored = readStoredScan(db, filePath, homeRoot, size, mtimeMs);
	if (stored !== undefined) {
		remember(key, stored);
		return stored;
	}

	const scan = coldScan(db, filePath, homeRoot, options.sliceMs ?? DEFAULT_SLICE_MS)
		.catch(() => emptyResources(homeRoot))
		.finally(() => inFlight.delete(key));
	inFlight.set(key, scan);
	return scan;
}

function readStoredScan(
	db: IndexDb,
	filePath: string,
	homeRoot: string,
	size: number,
	mtimeMs: number,
): SessionResources | undefined {
	try {
		const row = db
			.select()
			.from(schema.sessionResourceScans)
			.where(eq(schema.sessionResourceScans.filePath, filePath))
			.get();
		if (
			row === undefined ||
			row.homeRoot !== homeRoot ||
			row.size !== size ||
			row.mtimeMs !== mtimeMs ||
			row.scanVersion !== SCAN_VERSION
		) {
			return undefined;
		}
		const parsed = SessionResourcesResponse.safeParse(JSON.parse(row.resources));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Store the result without holding up the reply. The indexer can hold the
 * write lock for a while (a whole startup scan), so wait it out; failing only
 * costs the next restart a rescan.
 */
function storeScan(
	db: IndexDb,
	filePath: string,
	homeRoot: string,
	size: number,
	mtimeMs: number,
	resources: SessionResources,
): void {
	const row = {homeRoot, size, mtimeMs, scanVersion: SCAN_VERSION, resources: JSON.stringify(resources)};
	retryWhileBusy(() =>
		db
			.insert(schema.sessionResourceScans)
			.values({filePath, ...row})
			.onConflictDoUpdate({target: schema.sessionResourceScans.filePath, set: row})
			.run(),
	).catch(() => undefined);
}

/**
 * `api-request` records are about 80% of a long session's bytes (a 405 MB
 * transcript held 336 MB of them) and never carry a file or link: the record
 * processor renders nothing for one that parses. So the scan does not parse
 * them. It puts this stand-in in their place, which keeps every later record's
 * index -- the anchors -- and parses just as a real one does.
 *
 * Only Claude Code writes these lines, always as `JSON.stringify` output with
 * `type` first, so the prefix identifies one without parsing it. The `}`
 * check keeps a torn final line, which the full parse would drop, out of it.
 */
const API_REQUEST_PREFIX = Buffer.from('{"type":"api-request",');
const CLOSING_BRACE = 0x7d;
const API_REQUEST_STAND_IN: Record<string, unknown> = {
	type: "api-request",
	sessionId: "",
	id: "",
	timestamp: "",
	version: "",
	querySource: "",
	shapeHash: "",
	params: {
		model: "",
		betas: [],
		max_tokens: 0,
		thinking: {type: "", display: ""},
		context_management: {edits: []},
		output_config: {effort: ""},
	},
	keep: 0,
	tail: [],
	cacheControl: [],
	requestDigest: "",
};

/** Where a skipped `api-request` line sits: its record index and byte range. */
interface SkippedRecord {
	index: number;
	start: number;
	end: number;
}

async function scanFile(filePath: string, size: number, homeRoot: string, slicer: Slicer): Promise<SessionResources> {
	try {
		const skipped: SkippedRecord[] = [];
		const folds: [number, number][] = [];
		const lines = await processFile(filePath, size, slicer, skipped, (from, to) => folds.push([from, to]));

		// A real `api-request` that fails to parse is no stand-in: it draws an
		// unparsed row, and a row between two runs of the same command stops the
		// second from being folded into the first. Folding is the only thing such
		// a row changes here, so only the skipped records inside a fold need
		// checking. If one of them would not parse, scan again reading them all.
		if (await skippedRecordsParse(filePath, skippedInFolds(skipped, folds))) return extract(lines, homeRoot);
		return extract(await processFile(filePath, size, slicer, undefined, undefined), homeRoot);
	} catch {
		return emptyResources(homeRoot);
	}
}

function extract(lines: SessionLine[], homeRoot: string): SessionResources {
	return {files: extractSessionFiles(lines, homeRoot), links: collectSessionLinks(lines)};
}

function skippedInFolds(skipped: SkippedRecord[], folds: [number, number][]): SkippedRecord[] {
	return skipped.filter(({index}) => folds.some(([from, to]) => from < index && index < to));
}

async function skippedRecordsParse(filePath: string, records: SkippedRecord[]): Promise<boolean> {
	if (records.length === 0) return true;
	const file = await open(filePath, "r");
	try {
		for (const {start, end} of records) {
			const buffer = Buffer.alloc(end - start);
			await file.read(buffer, 0, buffer.length, start);
			let record: unknown;
			try {
				record = JSON.parse(buffer.toString("utf8"));
			} catch {
				return false;
			}
			if (!JsonlRecordSchema.safeParse(record).success) return false;
		}
		return true;
	} finally {
		await file.close();
	}
}

/**
 * The processed lines of the file's first `size` bytes. Stopping at the stat'd
 * size keeps the result consistent with the memo key while the session is
 * still appending. Record 0 is the file's first record, so every occurrence's
 * `anchorIndex` is session-absolute and comparable with the transcript
 * window's `startIndex`. The parsed records are dropped as soon as they are
 * processed; only the lines, far smaller once `api-request` records are
 * skipped, live on into extraction.
 *
 * With `skipped`, `api-request` lines are not parsed (see
 * `API_REQUEST_STAND_IN`) and are listed there instead; without it, every line
 * is parsed.
 */
async function processFile(
	filePath: string,
	size: number,
	slicer: Slicer,
	skipped: SkippedRecord[] | undefined,
	onFold: ((fromLineIndex: number, toLineIndex: number) => void) | undefined,
): Promise<SessionLine[]> {
	const records = await readRecords(filePath, size, slicer, skipped);
	const {lines} = await runCooperatively(processTranscriptSteps(records, 0, undefined, onFold), slicer);
	return lines;
}

function isApiRequestLine(buffer: Buffer, start: number, end: number): boolean {
	return (
		end - start > API_REQUEST_PREFIX.length &&
		buffer[end - 1] === CLOSING_BRACE &&
		buffer.compare(API_REQUEST_PREFIX, 0, API_REQUEST_PREFIX.length, start, start + API_REQUEST_PREFIX.length) === 0
	);
}

/** The file's first `size` bytes as records, read in chunks and parsed with pauses. */
async function readRecords(
	filePath: string,
	size: number,
	slicer: Slicer,
	skipped: SkippedRecord[] | undefined,
): Promise<Record<string, unknown>[]> {
	const records: Record<string, unknown>[] = [];
	if (size === 0) return records;

	// `base` is the file offset of `buffer[0]`.
	const parseLine = (buffer: Buffer, base: number, start: number, end: number): void => {
		if (skipped !== undefined && isApiRequestLine(buffer, start, end)) {
			skipped.push({index: records.length, start: base + start, end: base + end});
			records.push(API_REQUEST_STAND_IN);
			return;
		}
		const line = buffer.toString("utf8", start, end);
		if (!line.trim()) return;
		const record = parseTranscriptLine(line);
		if (record) records.push(record);
	};

	let carry: Buffer | undefined;
	let carryBase = 0;
	let nextBase = 0;
	const stream = createReadStream(filePath, {start: 0, end: size - 1, highWaterMark: READ_CHUNK_BYTES});
	for await (const chunk of stream as AsyncIterable<Buffer>) {
		const buffer: Buffer = carry === undefined ? chunk : Buffer.concat([carry, chunk]);
		const base = carry === undefined ? nextBase : carryBase;
		nextBase += chunk.length;
		let position = 0;
		for (;;) {
			const newline = buffer.indexOf(NEWLINE, position);
			if (newline === -1) break;
			parseLine(buffer, base, position, newline);
			position = newline + 1;
			if (slicer.due()) await slicer.pause();
		}
		carry = position < buffer.length ? buffer.subarray(position) : undefined;
		carryBase = base + position;
	}
	if (carry !== undefined) parseLine(carry, carryBase, 0, carry.length);
	return records;
}
