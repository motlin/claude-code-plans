import {appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {like, sql} from "drizzle-orm";
import Database from "better-sqlite3";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {openTestDb, type AppDb} from "../../src/lib/db/connection";
import {createJsonlIndexCache, fullScan, indexJsonlFile} from "../../src/lib/db/indexer";
import * as schema from "../../src/lib/db/schema";
import {currentPerfCounters, withPerfScope} from "../../src/lib/perf/server-scope";

const PROJECT = "-tmp-alice-project";
const ALICE = "session-alice";
const BOB = "session-bob";
let directory: string;
let db: AppDb;
let modificationTime: number;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "bridge-index-test-"));
	mkdirSync(join(directory, PROJECT));
	db = openTestDb();
	modificationTime = 946_684_800;
});

afterEach(() => {
	db.close();
	rmSync(directory, {recursive: true, force: true});
});

function bridge(sessionId: string, bridgeSessionId: string) {
	return {type: "bridge-session", sessionId, bridgeSessionId, lastSequenceNum: 0};
}

function jsonl(records: unknown[]): string {
	return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function write(sessionId: string, records: unknown[]): string {
	const path = join(directory, PROJECT, `${sessionId}.jsonl`);
	writeFileSync(path, jsonl(records));
	utimesSync(path, modificationTime, ++modificationTime);
	return path;
}

function aliases(database = db.index) {
	return Object.fromEntries(
		database
			.select()
			.from(schema.metadata)
			.where(like(schema.metadata.key, "bridge:v1:%"))
			.orderBy(schema.metadata.key)
			.all()
			.map(({key, value}) => [key, JSON.parse(value)]),
	);
}

describe("indexed Remote Control aliases", () => {
	it("keeps validated historical aliases and the latest canonical ID for their local owner", async () => {
		const path = write(ALICE, [
			bridge(ALICE, "cse_alice_100"),
			bridge(ALICE, "session_alice_200"),
			bridge(ALICE, "cse_alice_100"),
			bridge(BOB, "cse_bob_100"),
			{...bridge(ALICE, "cse_alice_300"), unexpected: true},
			bridge(ALICE, "cse_alice/400"),
			bridge(ALICE, "unknown_alice_500"),
			{type: "bridge-session", sessionId: ALICE},
		]);
		await indexJsonlFile(db.index, path, PROJECT);
		expect(aliases()).toStrictEqual({
			"bridge:v1:local:session-alice": {
				aliases: ["session_alice_100", "session_alice_200"],
				canonical: "session_alice_100",
			},
			"bridge:v1:alias:session_alice_100": [ALICE],
			"bridge:v1:alias:session_alice_200": [ALICE],
		});
	});

	it("records an empty mapping for a transcript without bridge records", async () => {
		await indexJsonlFile(db.index, write(ALICE, [{type: "user", message: {content: "Example prompt"}}]), PROJECT);
		expect(aliases()).toStrictEqual({"bridge:v1:local:session-alice": {aliases: [], canonical: null}});
	});

	it("indexes appended bridge records with the same aliases as a full parse and no extra file read", async () => {
		const cache = createJsonlIndexCache();
		const path = write(ALICE, [bridge(ALICE, "cse_alice_100")]);
		await indexJsonlFile(db.index, path, PROJECT, {cache});
		const appended = jsonl([bridge(ALICE, "cse_alice_200")]);
		appendFileSync(path, appended);
		utimesSync(path, modificationTime, ++modificationTime);
		const counters = await withPerfScope("bridge-index-append", async () => {
			await indexJsonlFile(db.index, path, PROJECT, {cache});
			return {...currentPerfCounters()!.jsonl};
		});
		const fresh = openTestDb();
		try {
			await indexJsonlFile(fresh.index, path, PROJECT);
			expect({counters, aliases: aliases()}).toStrictEqual({
				counters: {bytesRead: Buffer.byteLength(appended) + 64, fullScans: 0},
				aliases: aliases(fresh.index),
			});
		} finally {
			fresh.close();
		}
	});

	it("removes obsolete ownership on a rewrite without removing a different owner's claim", async () => {
		const cache = createJsonlIndexCache();
		const path = write(ALICE, [bridge(ALICE, "cse_shared_100"), bridge(ALICE, "cse_alice_100")]);
		await indexJsonlFile(db.index, path, PROJECT, {cache});
		await indexJsonlFile(db.index, write(BOB, [bridge(BOB, "cse_shared_100")]), PROJECT);
		expect(aliases()).toStrictEqual({
			"bridge:v1:local:session-alice": {
				aliases: ["session_alice_100", "session_shared_100"],
				canonical: "session_alice_100",
			},
			"bridge:v1:local:session-bob": {aliases: ["session_shared_100"], canonical: "session_shared_100"},
			"bridge:v1:alias:session_alice_100": [ALICE],
			"bridge:v1:alias:session_shared_100": [ALICE, BOB],
		});

		write(ALICE, [bridge(ALICE, "cse_alice_200")]);
		await indexJsonlFile(db.index, path, PROJECT, {cache});
		expect(aliases()).toStrictEqual({
			"bridge:v1:local:session-alice": {aliases: ["session_alice_200"], canonical: "session_alice_200"},
			"bridge:v1:local:session-bob": {aliases: ["session_shared_100"], canonical: "session_shared_100"},
			"bridge:v1:alias:session_alice_200": [ALICE],
			"bridge:v1:alias:session_shared_100": [BOB],
		});
	});

	it("preserves moved sessions and prunes only the deleted owner's aliases", async () => {
		const path = write(ALICE, [bridge(ALICE, "cse_shared_100")]);
		write(BOB, [bridge(BOB, "cse_shared_100")]);
		await fullScan(db.index, db.summaries, directory);
		const beforeMove = aliases();
		const movedProject = join(directory, "-tmp-bob-project");
		mkdirSync(movedProject);
		const movedPath = join(movedProject, `${ALICE}.jsonl`);
		renameSync(path, movedPath);
		await fullScan(db.index, db.summaries, directory);
		expect(aliases()).toStrictEqual(beforeMove);

		rmSync(movedPath);
		await fullScan(db.index, db.summaries, directory);
		expect(aliases()).toStrictEqual({
			"bridge:v1:local:session-bob": {aliases: ["session_shared_100"], canonical: "session_shared_100"},
			"bridge:v1:alias:session_shared_100": [BOB],
		});
	});

	it("rolls back reverse ownership changes if persisting the forward mapping fails", async () => {
		const cache = createJsonlIndexCache();
		const path = write(ALICE, [bridge(ALICE, "cse_alice_100")]);
		await indexJsonlFile(db.index, path, PROJECT, {cache});
		const before = aliases();
		db.index.run(sql`CREATE TEMP TRIGGER reject_bridge_update BEFORE UPDATE ON main.metadata
			WHEN NEW.key = 'bridge:v1:local:session-alice'
			BEGIN SELECT RAISE(ABORT, 'Example bridge write failure'); END`);
		appendFileSync(path, jsonl([bridge(ALICE, "cse_alice_200")]));
		utimesSync(path, modificationTime, ++modificationTime);
		await expect(indexJsonlFile(db.index, path, PROJECT, {cache})).rejects.toThrow(
			new Database.SqliteError("Example bridge write failure", "SQLITE_CONSTRAINT_TRIGGER"),
		);
		expect(aliases()).toStrictEqual(before);

		db.index.run(sql`DROP TRIGGER reject_bridge_update`);
		await indexJsonlFile(db.index, path, PROJECT, {cache});
		expect(aliases()).toStrictEqual({
			"bridge:v1:local:session-alice": {
				aliases: ["session_alice_100", "session_alice_200"],
				canonical: "session_alice_200",
			},
			"bridge:v1:alias:session_alice_100": [ALICE],
			"bridge:v1:alias:session_alice_200": [ALICE],
		});
	});

	it("persists aliases when a cached transcript is indexed into another database", async () => {
		const cache = createJsonlIndexCache();
		const path = write(ALICE, [bridge(ALICE, "cse_alice_100")]);
		await indexJsonlFile(db.index, path, PROJECT, {cache});
		const fresh = openTestDb();
		try {
			await indexJsonlFile(fresh.index, path, PROJECT, {cache});
			expect(aliases(fresh.index)).toStrictEqual(aliases());
		} finally {
			fresh.close();
		}
	});
});
