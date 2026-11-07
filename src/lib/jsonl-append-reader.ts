import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import type * as schema from "./db/schema";
import {hmrPersist} from "./hmr-persist";
import {jsonlOffsetWitness, jsonlReadOffset, type JsonlOffsetWitness} from "./jsonl-resume-offset";
import {stat} from "node:fs/promises";
import {DOMAIN_EVENTS} from "./event-names";
import type {JsonValue, SessionLinesAppendedPayload, SessionTranscriptRewrittenPayload} from "./hook-events";
import {recentlyBroadcast} from "./update-dedupe";

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

/**
 * Each offsets map's witness per path: the inode and bytes before the stored offset, so the next read can tell an
 * append from a rewrite below the offset. Kept beside the offsets rather than in them so callers keep a plain map.
 */
const offsetWitnesses = new WeakMap<Map<string, number>, Map<string, JsonlOffsetWitness>>();

export interface AppendedJsonlLines {
	lines: Record<string, JsonValue>[];
	nextByteOffset: number;
	/**
	 * The file was rewritten below the stored offset (lines removed or replaced), so the read resumed at its end and
	 * `lines` holds only what follows there: a client holding earlier rows must re-read the transcript.
	 */
	rewritten: boolean;
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
	let witnesses = offsetWitnesses.get(offsets);
	if (witnesses === undefined) {
		witnesses = new Map();
		offsetWitnesses.set(offsets, witnesses);
	}
	const offset = offsets.get(path);
	const start = await jsonlReadOffset(db, path, offset, offset === undefined ? undefined : witnesses.get(path));
	const {readNewJsonlLines} = await import("./sessions");
	const result = await readNewJsonlLines(path, start.offset);
	offsets.set(path, result.nextByteOffset);
	const witness = await jsonlOffsetWitness(path, result.nextByteOffset);
	if (witness === undefined) witnesses.delete(path);
	else witnesses.set(path, witness);
	return {...result, rewritten: start.rewritten};
}

/**
 * Broadcast one read's result for `sessionId`: `session:transcript-rewritten` when the file was rewritten below the
 * offset (without the lines read in that pass, since the client re-reads the tail, which holds them), otherwise
 * `session:lines-appended` with the new lines. Deduped across the watcher and the hook dispatcher, which both read.
 */
export async function broadcastAppendedJsonl(
	path: string,
	sessionId: string,
	read: AppendedJsonlLines,
	broadcast: (type: string, data: Record<string, unknown>) => void,
	dedupeTtlMs: number,
): Promise<void> {
	if (read.rewritten) {
		const {ino, size} = await stat(path);
		const key = `${DOMAIN_EVENTS.SESSION_TRANSCRIPT_REWRITTEN}:${sessionId}:${ino}:${size}`;
		if (!recentlyBroadcast(key, dedupeTtlMs)) {
			broadcast(DOMAIN_EVENTS.SESSION_TRANSCRIPT_REWRITTEN, {
				sessionId,
			} satisfies SessionTranscriptRewrittenPayload);
		}
		return;
	}
	if (read.lines.length === 0) return;
	const key = `${DOMAIN_EVENTS.SESSION_LINES_APPENDED}:${sessionId}:${read.nextByteOffset}`;
	if (recentlyBroadcast(key, dedupeTtlMs)) return;
	const {jsonlWrittenAt} = await import("./sessions");
	broadcast(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {
		sessionId,
		lines: read.lines,
		writtenAt: await jsonlWrittenAt(path),
	} satisfies SessionLinesAppendedPayload);
}
