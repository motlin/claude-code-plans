import {spawn, type ChildProcess} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {sql} from "drizzle-orm";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {replaceArtifactEvents} from "../../src/lib/db/artifact-index";
import {openAppDb, type AppDb} from "../../src/lib/db/connection";
import {scanFileContentRoots} from "../../src/lib/db/indexer";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// A second process (standing in for the previous dev-server instance that is
// still mid-scan) takes the write lock, holds it for `holdMs`, then commits.
const HOLD_LOCK_SCRIPT = `
const Database = require("better-sqlite3");
const db = new Database(process.argv[1]);
db.exec("BEGIN IMMEDIATE");
db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('lock_holder', 'other-process')").run();
process.stdout.write("locked\\n");
setTimeout(() => {
	db.exec("COMMIT");
	db.close();
}, Number(process.argv[2]));
`;

function holdWriteLock(dbPath: string, holdMs: number): Promise<ChildProcess> {
	const child = spawn(process.execPath, ["-e", HOLD_LOCK_SCRIPT, dbPath, String(holdMs)], {
		cwd: REPO_ROOT,
		stdio: ["ignore", "pipe", "inherit"],
	});
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => reject(new Error(`lock holder exited early with ${code}`)));
		child.stdout!.on("data", (chunk: Buffer) => {
			if (chunk.toString().includes("locked")) resolve(child);
		});
	});
}

function exited(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise((resolve) => child.once("exit", () => resolve()));
}

describe("index DB writes while another connection holds the write lock", () => {
	const cleanups: (() => void)[] = [];

	afterEach(() => {
		for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	});

	function openTempDb(): {db: AppDb; dbPath: string} {
		const cacheDir = mkdtempSync(join(tmpdir(), "busy-lock-test-"));
		const db = openAppDb({cacheDir});
		cleanups.push(() => rmSync(cacheDir, {recursive: true, force: true}));
		cleanups.push(() => db.close());
		return {db, dbPath: join(cacheDir, "index.db")};
	}

	it("sets an explicit busy timeout on both databases", () => {
		const {db} = openTempDb();
		expect({
			index: db.index.get(sql`PRAGMA busy_timeout`),
			summaries: db.summaries.get(sql`PRAGMA busy_timeout`),
		}).toStrictEqual({index: {timeout: 10_000}, summaries: {timeout: 10_000}});
	});

	it("replaceArtifactEvents waits for the lock instead of throwing SQLITE_BUSY", async () => {
		const {db, dbPath} = openTempDb();
		const child = await holdWriteLock(dbPath, 300);

		replaceArtifactEvents(
			db.index,
			{filePath: "/transcripts/a.jsonl", sessionId: "session-a", projectId: "project-a", isSubagent: false},
			[],
		);

		await exited(child);
		expect(db.index.all(sql`SELECT value FROM metadata WHERE key = 'lock_holder'`)).toStrictEqual([
			{value: "other-process"},
		]);
	});

	it("the file-content scan's stale-row cleanup waits for the lock instead of throwing SQLITE_BUSY", async () => {
		const {db, dbPath} = openTempDb();
		db.index.run(sql`INSERT INTO file_content(path, content) VALUES ('/gone/file.ts', 'stale')`);
		const child = await holdWriteLock(dbPath, 300);

		await scanFileContentRoots(db.index, [], new Set());

		await exited(child);
		expect(db.index.all(sql`SELECT path FROM file_content`)).toStrictEqual([]);
	});
});
