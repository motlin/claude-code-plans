import {open, realpath} from "node:fs/promises";
import {eq} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

const BACKWARD_READ_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

/**
 * Where to start reading a transcript's appended lines when this process has no byte offset for it yet, as after a
 * restart: the start of the line the index stopped in, or the start of the file for a transcript the index has not
 * seen or that shrank since. Starting at zero instead re-reads and re-broadcasts a long transcript's whole history
 * in one `session:lines-appended` event, whose serialization blocks the event loop for hundreds of milliseconds.
 */
export async function jsonlResumeOffset(db: IndexDb, filePath: string): Promise<number> {
	// The scan indexes transcripts under the resolved projects directory, while hooks name them by the unresolved one.
	const indexedSize =
		indexedSizeBytes(db, filePath) ?? indexedSizeBytes(db, await realpath(filePath).catch(() => ""));
	if (indexedSize === undefined || indexedSize <= 0) return 0;

	let handle;
	try {
		handle = await open(filePath, "r");
	} catch {
		return 0;
	}
	try {
		const {size} = await handle.stat();
		if (indexedSize > size) return 0;
		return await lineStartAtOrBefore(handle, indexedSize);
	} finally {
		await handle.close();
	}
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
