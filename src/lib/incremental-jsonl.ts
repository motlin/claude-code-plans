import {stat} from "node:fs/promises";
import {trackedCreateReadStream} from "./perf/tracked-fs";

/** Bytes re-read before a cached offset to confirm the file still holds what was parsed, not a rewrite. */
const SIGNATURE_BYTES = 64;
const NEWLINE = 0x0a;
const EMPTY = Buffer.alloc(0);

/** How a caller folds one transcript's lines into its own state. */
export interface JsonlFold<S> {
	create(): S;
	/** Called once per non-blank line, oldest first. */
	add(state: S, line: string): void;
}

interface Entry<S> {
	state: S;
	/** Byte offset just past the last newline the state has consumed. */
	offset: number;
	ino: number;
	/** The bytes right before `offset`. */
	signature: Buffer;
}

/**
 * Parse state for append-only JSONL files, keyed by path, so re-reading a live transcript after an append costs only
 * the appended bytes. Least recently used entries are evicted past `maxEntries`, since each one holds a whole
 * transcript's parse state.
 */
export class IncrementalJsonlCache<S> {
	private readonly entries = new Map<string, Entry<S>>();
	private readonly locks = new Map<string, Promise<unknown>>();

	constructor(private readonly maxEntries: number) {}

	/**
	 * Runs `fn` after every earlier `exclusive` call for `path` has settled. A cached state is mutated in place while
	 * it folds new lines, so two overlapping folds of one file would otherwise both apply the same lines to it.
	 */
	async exclusive<T>(path: string, fn: () => Promise<T>): Promise<T> {
		const previous = this.locks.get(path) ?? Promise.resolve();
		const run = previous.then(fn, fn);
		const settled = run.catch(() => undefined);
		this.locks.set(path, settled);
		try {
			return await run;
		} finally {
			if (this.locks.get(path) === settled) this.locks.delete(path);
		}
	}

	get(path: string): Entry<S> | undefined {
		const entry = this.entries.get(path);
		if (entry !== undefined) {
			this.entries.delete(path);
			this.entries.set(path, entry);
		}
		return entry;
	}

	set(path: string, entry: Entry<S>): void {
		this.entries.delete(path);
		this.entries.set(path, entry);
		for (const oldest of this.entries.keys()) {
			if (this.entries.size <= this.maxEntries) break;
			this.entries.delete(oldest);
		}
	}

	delete(path: string): void {
		this.entries.delete(path);
	}
}

/** The cached state for `path` when it already covers the whole file as it is now. */
export async function currentJsonlState<S>(cache: IncrementalJsonlCache<S>, path: string): Promise<S | undefined> {
	const entry = cache.get(path);
	if (entry === undefined) return undefined;
	const fileStat = await stat(path);
	return entry.ino === fileStat.ino && entry.offset === fileStat.size ? entry.state : undefined;
}

/**
 * Folds every line of `path` into a state. With a cache, a file that only grew since the cached parse is read from
 * the cached offset on; anything else (a new file, a truncation, a rewrite, a different inode) is parsed in full.
 * A trailing line without its newline is folded in but leaves the file uncached, since a later write may complete it.
 * Yields to the event loop after every chunk, so a full parse of a huge transcript never blocks it for long.
 * Callers that pass a cache run this, and whatever they do with the state, inside `cache.exclusive(path, ...)`.
 */
export async function foldJsonl<S>(path: string, fold: JsonlFold<S>, cache?: IncrementalJsonlCache<S>): Promise<S> {
	const fileStat = await stat(path);
	const entry = cache?.get(path);
	let read: ReadResult | null = null;
	let state: S | undefined;
	if (entry !== undefined && entry.ino === fileStat.ino && fileStat.size >= entry.offset) {
		try {
			read = await readLines(path, entry.offset, entry.signature, (line) => fold.add(entry.state, line));
		} catch (error) {
			// The cached state may have taken some of the new lines; it no longer matches its offset.
			cache!.delete(path);
			throw error;
		}
		if (read !== null) state = entry.state;
	}
	if (read === null || state === undefined) {
		const fresh = fold.create();
		read = (await readLines(path, 0, EMPTY, (line) => fold.add(fresh, line)))!;
		state = fresh;
	}

	if (read.unterminatedTail) cache?.delete(path);
	else cache?.set(path, {state, offset: read.offset, ino: fileStat.ino, signature: read.signature});
	return state;
}

interface ReadResult {
	offset: number;
	signature: Buffer;
	unterminatedTail: boolean;
}

/**
 * Streams the lines after `offset`, first checking that the `signature.length` bytes before it equal `signature`.
 * Returns null, before calling `onLine` at all, when they differ.
 */
async function readLines(
	path: string,
	offset: number,
	signature: Buffer,
	onLine: (line: string) => void,
): Promise<ReadResult | null> {
	const stream = trackedCreateReadStream(path, {start: offset - signature.length});
	let unverified = signature.length;
	let verified = EMPTY;
	let carry = EMPTY;
	let consumed = offset;
	let lastBytes = signature;
	try {
		for await (const chunk of stream as AsyncIterable<Buffer>) {
			let buffer = chunk;
			if (unverified > 0) {
				const take = Math.min(unverified, buffer.length);
				verified = Buffer.concat([verified, buffer.subarray(0, take)]);
				buffer = buffer.subarray(take);
				unverified -= take;
				if (unverified === 0 && !verified.equals(signature)) return null;
			}
			if (carry.length > 0) buffer = Buffer.concat([carry, buffer]);

			let start = 0;
			for (let newline = buffer.indexOf(NEWLINE); newline !== -1; newline = buffer.indexOf(NEWLINE, start)) {
				emit(buffer.subarray(start, newline), onLine);
				start = newline + 1;
			}
			if (start > 0) {
				consumed += start;
				lastBytes = tail(Buffer.concat([lastBytes, tail(buffer.subarray(0, start))]));
			}
			carry = Buffer.from(buffer.subarray(start));
			await new Promise<void>((resolveYield) => setImmediate(resolveYield));
		}
	} finally {
		stream.destroy();
	}
	if (unverified > 0) return null;
	const unterminatedTail = carry.toString("utf-8").trim() !== "";
	if (unterminatedTail) emit(carry, onLine);
	return {offset: consumed, signature: Buffer.from(lastBytes), unterminatedTail};
}

function tail(buffer: Buffer): Buffer {
	return buffer.length > SIGNATURE_BYTES ? buffer.subarray(buffer.length - SIGNATURE_BYTES) : buffer;
}

function emit(bytes: Buffer, onLine: (line: string) => void): void {
	let line = bytes.toString("utf-8");
	if (line.endsWith("\r")) line = line.slice(0, -1);
	if (line.trim()) onLine(line);
}
