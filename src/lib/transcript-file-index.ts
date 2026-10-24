import {closeSync, fstatSync, openSync} from "node:fs";
import {trackedReadRange} from "./perf/tracked-fs";
import {isCountableMessageRecord} from "./message-count";
import {asRecord} from "./narrow";
import {chainSkeleton, computeAbandoned, type AbandonedBranches} from "./transcript-chain";

/**
 * A per-file index of a transcript JSONL: where each non-blank line sits, the
 * whole file's active chain, and the countable-message prefix sums. Building it
 * parses every line once; after that a window request reads and parses only
 * the lines it serves, and an append parses only the appended lines.
 *
 * Lines are what `split("\n").filter((line) => line.trim())` would yield, so
 * record indices match the rest of the transcript API.
 */
export interface TranscriptFileIndex {
	/** File size and mtime the index was built for. */
	size: number;
	mtimeMs: number;
	/** Byte offset just after the last line break the index has consumed. */
	consumed: number;
	/** True when the last indexed line has no line break yet, so an append may extend it. */
	partialTail: boolean;
	/** Byte range `[start, end)` of each line, line break excluded. */
	starts: number[];
	ends: number[];
	/** Each line's `chainSkeleton`, or undefined when the line is not a JSON object. */
	skeletons: (Record<string, unknown> | undefined)[];
	/** `countableBefore[i]` is the countable messages in lines `0..i-1`; one longer than `starts`. */
	countableBefore: number[];
	abandoned: AbandonedBranches;
	/** Whether each line's uuid is on an abandoned branch. */
	hidden: boolean[];
}

export interface OpenTranscriptFile {
	fd: number;
	index: TranscriptFileIndex;
	/** The whole file, when the index was just built from it; saves rereading the window. */
	buffer: Buffer | undefined;
}

const CACHE_LIMIT = 8;
const cache = new Map<string, TranscriptFileIndex>();

/** Drop every cached index. For tests and benchmarks that need a cold read. */
export function clearTranscriptFileIndexCache(): void {
	cache.clear();
}

/** One JSONL line as a record, or undefined when the line is not a valid JSON object. */
export function parseTranscriptLine(line: string): Record<string, unknown> | undefined {
	try {
		return asRecord(JSON.parse(line));
	} catch {
		return undefined;
	}
}

const NEWLINE = 0x0a;

/** Append the lines in `buffer` (which starts at file offset `base`) to `index`. */
function appendLines(index: TranscriptFileIndex, buffer: Buffer, base: number): void {
	let position = 0;
	while (position < buffer.length) {
		const newline = buffer.indexOf(NEWLINE, position);
		const end = newline === -1 ? buffer.length : newline;
		const line = buffer.toString("utf8", position, end);
		if (line.trim()) {
			const record = parseTranscriptLine(line);
			index.starts.push(base + position);
			index.ends.push(base + end);
			index.skeletons.push(record === undefined ? undefined : chainSkeleton(record));
			index.countableBefore.push(
				(index.countableBefore.at(-1) ?? 0) + (isCountableMessageRecord(record) ? 1 : 0),
			);
			index.partialTail = newline === -1;
		}
		if (newline === -1) break;
		index.consumed = base + newline + 1;
		position = newline + 1;
	}
}

function refreshChain(index: TranscriptFileIndex): void {
	index.abandoned = computeAbandoned(index.skeletons.filter((skeleton) => skeleton !== undefined));
	index.hidden = index.skeletons.map((skeleton) => {
		const uuid = skeleton?.["uuid"];
		return typeof uuid === "string" && index.abandoned.hidden.has(uuid);
	});
}

function build(fd: number, size: number, mtimeMs: number): {index: TranscriptFileIndex; buffer: Buffer} {
	const buffer = trackedReadRange(fd, 0, size, size);
	const index: TranscriptFileIndex = {
		size,
		mtimeMs,
		consumed: 0,
		partialTail: false,
		starts: [],
		ends: [],
		skeletons: [],
		countableBefore: [0],
		abandoned: {hidden: new Set(), cuts: []},
		hidden: [],
	};
	appendLines(index, buffer, 0);
	refreshChain(index);
	return {index, buffer};
}

/**
 * Extend `index` in place with the bytes appended since it was built. Returns
 * false when the file no longer starts with the indexed bytes as far as one
 * cheap check can tell (the byte before `consumed` is no longer a line break).
 */
function extend(fd: number, index: TranscriptFileIndex, size: number, mtimeMs: number): boolean {
	const from = Math.max(0, index.consumed - 1);
	const appended = trackedReadRange(fd, from, size, size);
	if (index.consumed > 0 && appended[0] !== NEWLINE) return false;
	if (index.partialTail) {
		index.starts.pop();
		index.ends.pop();
		index.skeletons.pop();
		index.countableBefore.pop();
		index.partialTail = false;
	}
	appendLines(index, appended.subarray(index.consumed - from), index.consumed);
	refreshChain(index);
	index.size = size;
	index.mtimeMs = mtimeMs;
	return true;
}

/**
 * Open `filePath` and return its index, reusing the cached one while the file's
 * size and mtime are unchanged and extending it when the file only grew. The
 * caller closes `fd`.
 */
export function openTranscriptFile(filePath: string): OpenTranscriptFile {
	const fd = openSync(filePath, "r");
	try {
		const {size, mtimeMs} = fstatSync(fd);
		const cached = cache.get(filePath);
		cache.delete(filePath);
		let result: OpenTranscriptFile;
		if (cached?.size === size && cached.mtimeMs === mtimeMs) {
			result = {fd, index: cached, buffer: undefined};
		} else if (cached !== undefined && size > cached.size && extend(fd, cached, size, mtimeMs)) {
			result = {fd, index: cached, buffer: undefined};
		} else {
			result = {fd, ...build(fd, size, mtimeMs)};
		}
		cache.set(filePath, result.index);
		for (const key of cache.keys()) {
			if (cache.size <= CACHE_LIMIT) break;
			cache.delete(key);
		}
		return result;
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}

/** Byte offset where line `i` starts. */
export function lineStart(index: TranscriptFileIndex, i: number): number {
	return index.starts[i] ?? index.size;
}

/** Byte offset where line `i` ends, line break excluded. */
export function lineEnd(index: TranscriptFileIndex, i: number): number {
	return index.ends[i] ?? index.size;
}

/** Lines `[start, end)` of an open transcript file, parsed. */
export function readTranscriptLines(
	file: OpenTranscriptFile,
	start: number,
	end: number,
): (Record<string, unknown> | undefined)[] {
	const {index} = file;
	if (start >= end) return [];
	const from = lineStart(index, start);
	const to = lineEnd(index, end - 1);
	const bytes = file.buffer?.subarray(from, to) ?? trackedReadRange(file.fd, from, to, index.size);
	const lines: (Record<string, unknown> | undefined)[] = [];
	for (let i = start; i < end; i += 1) {
		lines.push(parseTranscriptLine(bytes.toString("utf8", lineStart(index, i) - from, lineEnd(index, i) - from)));
	}
	return lines;
}
