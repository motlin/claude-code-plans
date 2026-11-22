import {spawn, type ChildProcess} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {openAppDb, type AppDb} from "../../src/lib/db/connection";
import {fullScan} from "../../src/lib/db/indexer";
import {startStallMonitor, type EventLoopStall} from "../../src/lib/perf/event-loop-stalls";
import {PERF_SHAPES, generateTranscript} from "./fixtures/generate-transcript";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// In dev, nitro forwards every request to one worker thread; while that thread's event loop is blocked it cannot
// even accept connections, and the proxy fails with "connect ETIMEDOUT". No single synchronous slice of the scan
// may run longer than this.
const SLICE_BUDGET_MS = 1000;

// Another process (a second server on the same cache dir) holds the write lock for longer than the budget.
// better-sqlite3 waits for a lock by sleeping the calling thread, so the connection's short busy timeout bounds the
// sleep and the scan makes each write once.
const HOLD_LOCK_MS = 2500;

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

async function holdWriteLock(dbPath: string, holdMs: number): Promise<ChildProcess>
{
	const child = spawn(
		process.execPath,
		["-e", HOLD_LOCK_SCRIPT, dbPath, String(holdMs)],
		{
			cwd: REPO_ROOT,
			stdio: ["ignore", "pipe", "inherit"],
		},
	);
	return new Promise((resolve, reject) =>
	{
		child.once("error", reject);
		child.once("exit", (code) =>
		{
			reject(new Error(`lock holder exited early with ${code}`));
		});
		child.stdout.on("data", (chunk: Buffer) =>
		{
			if (chunk.toString().includes("locked")) resolve(child);
		});
	});
}

async function exited(child: ChildProcess): Promise<void>
{
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise((resolve) =>
	{
		child.once("exit", () =>
		{
			resolve();
		});
	});
}

describe("fullScan and the event loop", () =>
{
	const cleanups: (() => void)[] = [];

	afterEach(() =>
	{
		for (const cleanup of cleanups.splice(0).toReversed()) cleanup();
	});

	async function setUp(): Promise<
	{
		db: AppDb;
		dbPath: string;
		projectsDir: string;
	}>
	{
		const root = mkdtempSync(join(tmpdir(), "scan-event-loop-"));
		cleanups.push(() =>
		{
			rmSync(
				root,
				{
					recursive: true,
					force: true,
				},
			);
		});
		const projectsDir = join(root, "projects");
		const fixtures = [
			...[1, 2, 3, 4].map((seed) => (
			{
				shape: PERF_SHAPES.small,
				seed,
			})),
			...[1, 2].map((seed) => (
			{
				shape: PERF_SHAPES.typical,
				seed,
			})),
		];
		for (const [index, {shape, seed}] of fixtures.entries())
		{
			const projectDir = join(projectsDir, `-repo-${index % 2}`);
			mkdirSync(
				projectDir,
				{
					recursive: true,
				},
			);
			const sessionId = `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`;
			copyFileSync(await generateTranscript(shape, seed), join(projectDir, `${sessionId}.jsonl`));
		}
		const cacheDir = join(root, "cache");
		const db = openAppDb(
			{
				cacheDir,
			},
		);
		cleanups.push(() =>
		{
			db.close();
		});
		return {
			db,
			dbPath: join(cacheDir, "index.db"),
			projectsDir,
		};
	}

	it("fails with SQLITE_BUSY after one attempt, never blocking longer than the slice budget, while another process holds the write lock", async () =>
	{
		const {db, dbPath, projectsDir} = await setUp();
		const stalls: EventLoopStall[] = [];
		const stopMonitor = startStallMonitor(
			{
				thresholdMs: SLICE_BUDGET_MS,
				onStall: (stall) => stalls.push(stall),
			},
		);
		cleanups.push(stopMonitor);

		const child = await holdWriteLock(dbPath, HOLD_LOCK_MS);
		const failure: unknown = await fullScan(db.index, db.summaries, projectsDir).then(
			() => undefined,
			(err: unknown) => err,
		);
		// The scan has settled, so the rest of the hold proves nothing: a scan that waited for the lock would already
		// have stalled past the budget.
		child.kill();
		await exited(child);
		// Let the monitor observe the last slice before stopping it.
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 150);
		});
		stopMonitor();

		expect(
			{
				stalls: stalls.map((stall) => (
				{
					durationMs: Math.round(stall.durationMs),
					activities: stall.activities,
				})),
				code: failure instanceof Error ? Reflect.get(failure, "code") : failure,
			},
		).toStrictEqual(
			{
				stalls: [],
				code: "SQLITE_BUSY",
			},
		);
	}, 60_000);
});
