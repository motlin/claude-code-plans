import {open, realpath} from "node:fs/promises";
import {eq} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";
import {SIGNATURE_BYTES} from "./incremental-jsonl";

type IndexDb = BetterSQLite3Database<typeof schema>;

const BACKWARD_READ_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

/**
 * The most transcript bytes a resume replays. A live append is a few kilobytes; a transcript the index has not reached
 * yet (every one, right after a schema change wipes the index) can be hundreds of megabytes, and replaying it parsed
 * every record into one `session:lines-appended` event and ran the server out of heap. Past this, the read starts at
 * the end and the index, not the broadcast, catches the transcript up.
 */
export const MAX_JSONL_REPLAY_BYTES = 1024 * 1024;

/**
 * Where to start reading a transcript's appended lines when this process has no byte offset for it yet, as after a
 * restart: the start of the line the index stopped in, or the start of the file for a short transcript the index has
 * not seen or that shrank since. Starting at zero instead re-reads and re-broadcasts a long transcript's whole history
 * in one `session:lines-appended` event, whose serialization blocks the event loop for hundreds of milliseconds, so
 * when that would replay more than `MAX_JSONL_REPLAY_BYTES` the read starts at the line the file now ends in.
 */
export async function jsonlResumeOffset(db: IndexDb, filePath: string): Promise<number> {
	// The scan indexes transcripts under the resolved projects directory, while hooks name them by the unresolved one.
	const indexedSize =
		indexedSizeBytes(db, filePath) ?? indexedSizeBytes(db, await realpath(filePath).catch(() => ""));

	let handle;
	try {
		handle = await open(filePath, "r");
	} catch {
		return 0;
	}
	try {
		const {size} = await handle.stat();
		const resumeAt =
			indexedSize === undefined || indexedSize <= 0 || indexedSize > size
				? 0
				: await lineStartAtOrBefore(handle, indexedSize);
		return size - resumeAt > MAX_JSONL_REPLAY_BYTES ? await lineStartAtOrBefore(handle, size) : resumeAt;
	} finally {
		await handle.close();
	}
}

/** What a reader saw at its offset: the file's inode and the bytes right before the offset. */
export interface JsonlOffsetWitness {
	ino: number;
	signature: Buffer;
}

export interface JsonlReadStart {
	offset: number;
	/** True when the file no longer holds, before `offset`, what the `witness` saw there: the CLI removed or rewrote lines. */
	rewritten: boolean;
}

/**
 * Where to read a transcript's appended lines from: this process's cached `offset`, or the resume offset when it has
 * none. A transcript rewritten below the cached offset (the CLI removing a retracted line in place, or renaming a
 * compacted copy over it) would otherwise be read from mid-line, cutting or hiding later appends, so when the file is
 * shorter than the offset, or `witness` no longer matches its inode or the bytes before the offset, the read restarts
 * at the start of the file's last partial line, or at its end, and reports the rewrite.
 */
export async function jsonlReadOffset(
	db: IndexDb,
	filePath: string,
	offset: number | undefined,
	witness?: JsonlOffsetWitness,
): Promise<JsonlReadStart> {
	if (offset === undefined) return {offset: await jsonlResumeOffset(db, filePath), rewritten: false};
	let handle;
	try {
		handle = await open(filePath, "r");
	} catch {
		return {offset, rewritten: false};
	}
	try {
		const {size, ino} = await handle.stat();
		const rewritten =
			offset > size ||
			(witness !== undefined &&
				(ino !== witness.ino ||
					!(await bytesBefore(handle, offset, witness.signature.length)).equals(witness.signature)));
		return rewritten
			? {offset: await lineStartAtOrBefore(handle, size), rewritten: true}
			: {offset, rewritten: false};
	} finally {
		await handle.close();
	}
}

/** The inode of `filePath` and the up to `SIGNATURE_BYTES` bytes before `offset`, for the next `jsonlReadOffset`. */
export async function jsonlOffsetWitness(filePath: string, offset: number): Promise<JsonlOffsetWitness | undefined> {
	let handle;
	try {
		handle = await open(filePath, "r");
	} catch {
		return undefined;
	}
	try {
		const {ino} = await handle.stat();
		return {ino, signature: await bytesBefore(handle, offset, Math.min(offset, SIGNATURE_BYTES))};
	} finally {
		await handle.close();
	}
}

async function bytesBefore(handle: Awaited<ReturnType<typeof open>>, offset: number, length: number): Promise<Buffer> {
	const buffer = Buffer.alloc(length);
	const {bytesRead} = await handle.read(buffer, 0, length, offset - length);
	return buffer.subarray(0, bytesRead);
}

function indexedSizeBytes(db: IndexDb, path: string): number | undefined {
	if (path === "") return undefined;
	return db
		.select({sizeBytes: schema.indexedFiles.sizeBytes})
		.from(schema.indexedFiles)
		.where(eq(schema.indexedFiles.path, path))
		.get()?.sizeBytes;
}

/** The offset just past the last newline before `offset`, or zero when there is none. */
async function lineStartAtOrBefore(handle: Awaited<ReturnType<typeof open>>, offset: number): Promise<number> {
	const buffer = Buffer.alloc(BACKWARD_READ_BYTES);
	let end = offset;
	while (end > 0) {
		const start = Math.max(0, end - BACKWARD_READ_BYTES);
		const {bytesRead} = await handle.read(buffer, 0, end - start, start);
		const newline = buffer.subarray(0, bytesRead).lastIndexOf(NEWLINE);
		if (newline !== -1) return start + newline + 1;
		end = start;
	}
	return 0;
}
