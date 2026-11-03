import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import type * as schema from "./db/schema";
import {hmrPersist} from "./hmr-persist";
import {jsonlReadOffset} from "./jsonl-resume-offset";
import type {JsonValue} from "./hook-events";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * The one byte offset per transcript, keyed by its canonical (symlink-resolved) path, that both the hook dispatcher's
 * `session:lines-appended` fast path and the watcher's JSONL handler read from and advance. Two maps let each side
 * re-broadcast lines the other already sent, and the client appends every broadcast line, duplicating records that
 * carry no uuid. Persisted across HMR reloads so a hot reload does not replay seen lines.
 */
export const sharedJsonlOffsets = hmrPersist("jsonlOffsets", () => new Map<string, number>());

/** Each offsets map's in-flight read per path, so overlapping reads of one transcript run one after another. */
const readChains = new WeakMap<Map<string, number>, Map<string, Promise<unknown>>>();

export interface AppendedJsonlLines {
	lines: Record<string, JsonValue>[];
	nextByteOffset: number;
}

/**
 * Read the lines appended to `path` since `offsets` last advanced past them, and advance it. Reads of one path through
 * one map are serialized: a read starts only after the previous one stored its offset, so two overlapping fires never
 * both read the same range, and a slower earlier read cannot store an older offset over a newer one.
 */
export async function readAppendedJsonlLines(
	db: IndexDb,
	path: string,
	offsets: Map<string, number>,
): Promise<AppendedJsonlLines> {
	let chains = readChains.get(offsets);
	if (chains === undefined) {
		chains = new Map();
		readChains.set(offsets, chains);
	}
	const previous = chains.get(path) ?? Promise.resolve();
	const read = previous.then(
		async () => readFromOffset(db, path, offsets),
		async () => readFromOffset(db, path, offsets),
	);
	chains.set(path, read);
	try {
		return await read;
	} finally {
		if (chains.get(path) === read) chains.delete(path);
	}
}

async function readFromOffset(db: IndexDb, path: string, offsets: Map<string, number>): Promise<AppendedJsonlLines> {
	const fromOffset = await jsonlReadOffset(db, path, offsets.get(path));
	const {readNewJsonlLines} = await import("./sessions");
	const result = await readNewJsonlLines(path, fromOffset);
	offsets.set(path, result.nextByteOffset);
	return result;
}
