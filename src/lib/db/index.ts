import {openAppDb, type AppDb} from "./connection";
import {fullScan, scanFileContentRoots} from "./indexer";
import {isRecord} from "../narrow";
import {homedir} from "node:os";
import {join} from "node:path";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const TASKS_DIR = join(homedir(), ".claude", "tasks");
const PLANS_DIR = join(homedir(), ".claude", "plans");

// The connection and the in-flight initial scan live on globalThis rather
// than in module state. The production build bundles the nitro WebSocket
// routes apart from the SSR entry, so each evaluates its own copy of this
// module; module state would give each copy its own connection to the same
// files, contending for the write lock. openAppDb refuses that second
// connection outright.
//
// Concurrent callers await the same fullScan instead of racing two scans on
// the same DB. Two concurrent scans corrupt orphan-session inserts with
// SQLITE_CONSTRAINT_PRIMARYKEY because indexJsonlFile's existingSession check
// straddles async file I/O. runInitialScan/awaitInitialScan are the only
// entrypoints, and awaitInitialScan() observes whether a scan has started
// without forcing one to start.

type DbState =
{
	db: AppDb | null;
	/** The whole initial scan, index and file content. */
	scanPromise: Promise<void> | null;
	/** Settles when the session/plan index scan ends, before the slower file-content scan. */
	indexPromise: Promise<void> | null;
	/** The file-content scan has ended, so content search covers every indexed root. */
	fileContentScanDone: boolean;
	controller: AbortController;
	/**
	 * getDb() throws instead of opening the databases: shutdownDb() ran, or a
	 * starting server is still waiting for the previous instance to release
	 * them (holdDbUntilInit). Only initDb() opens them again.
	 */
	closed: boolean;
};

const DB_STATE = Symbol.for("claude-code-browser.db-state");

/** Only this module's copies write the slot, so an object there is their DbState. */
function isDbState(value: unknown): value is DbState
{
	return isRecord(value) && value["controller"] instanceof AbortController;
}

function getDbState(): DbState
{
	const existing: unknown = Reflect.get(globalThis, DB_STATE);
	if (isDbState(existing)) return existing;
	const created: DbState =
	{
		db: null,
		scanPromise: null,
		indexPromise: null,
		fileContentScanDone: false,
		controller: new AbortController(),
		closed: false,
	};
	Reflect.set(globalThis, DB_STATE, created);
	return created;
}

export function getDb(): AppDb
{
	const state = getDbState();
	if (state.closed)
	{
		throw new Error(
			"The databases are closed: this server instance shut down or has not finished taking over from the previous one",
		);
	}
	return (state.db ??= openAppDb());
}

/**
 * Keeps getDb() from opening the databases until initDb() runs. A starting
 * server calls this before its takeover, so nothing opens them while the
 * previous instance may still hold the write lock.
 */
export function holdDbUntilInit(): void
{
	getDbState().closed = true;
}

/**
 * Makes `db` the connection getDb() returns, handing back the one it replaced
 * without closing it. Tests point getDb() at a test database this way.
 */
export function replaceDb(db: AppDb | null): AppDb | null
{
	const state = getDbState();
	const previous = state.db;
	state.db = db;
	return previous;
}

/**
 * Opens the databases, reopening them for a server instance that took over
 * from one that shut down earlier in this thread, with a fresh scan state.
 */
export async function initDb(): Promise<AppDb>
{
	const state = getDbState();
	if (state.closed)
	{
		// The previous instance's shutdownDb() has finished: its scan ended and its connection closed.
		if (state.controller.signal.aborted)
		{
			state.controller = new AbortController();
			state.scanPromise = null;
			state.indexPromise = null;
			state.fileContentScanDone = false;
		}
		state.closed = false;
	}
	return Promise.resolve(getDb());
}

// This process holds the only connection, and shutdownDb() stops a restarting
// server's scan before the next instance opens the database, so a failure is
// final: log it once and let startup continue.
async function runScan(label: string, signal: AbortSignal, scan: () => Promise<void>): Promise<void>
{
	if (signal.aborted) return;
	try
	{
		await scan();
	}
	catch (err)
	{
		// oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while scan() is awaited
		if (signal.aborted) return;
		console.error(`${label} failed:`, err);
	}
}

// oxlint-disable-next-line typescript/promise-function-async -- concurrent calls share one scan promise
export function runInitialScan(
	fileContentRoots: readonly string[] = [],
	ignoredDirNames: ReadonlySet<string> = new Set(),
): Promise<void>
{
	const holder = getDbState();
	if (holder.scanPromise === null)
	{
		const {signal} = holder.controller;
		const indexPromise = runScan("Initial database scan", signal, async () =>
		{
			const db = getDb();
			await fullScan(db.index, db.summaries, PROJECTS_DIR, TASKS_DIR, PLANS_DIR, undefined, signal);
		});
		holder.indexPromise = indexPromise;
		holder.scanPromise = (async () =>
		{
			await indexPromise;
			await runScan("Initial file-content scan", signal, async () =>
				scanFileContentRoots(getDb().index, fileContentRoots, ignoredDirNames, signal),
			);
			holder.fileContentScanDone = true;
		})();
	}
	return holder.scanPromise;
}

export async function awaitInitialScan(): Promise<void>
{
	return getDbState().scanPromise ?? Promise.resolve();
}

/**
 * Settles once the initial session/plan index scan ends, without waiting for
 * the file-content scan: transcript events queued behind that slower scan left
 * a session created during startup unindexed for minutes.
 */
export async function awaitInitialIndexScan(): Promise<void>
{
	const holder = getDbState();
	return holder.indexPromise ?? holder.scanPromise ?? Promise.resolve();
}

/** Whether the initial file-content scan has ended, so content search no longer misses unscanned files. */
export function isFileContentScanDone(): boolean
{
	return getDbState().fileContentScanDone;
}

/** Aborts when shutdownDb() begins, so startup work can stop before the DB closes under it. */
export function getShutdownSignal(): AbortSignal
{
	return getDbState().controller.signal;
}

/**
 * Stops the initial scan and closes the databases, so a restarted server's
 * scan never contends with this instance for the write lock. Work still
 * running afterwards gets an error from getDb() rather than reopening them;
 * a server instance started later in this thread reopens them with initDb().
 */
export async function shutdownDb(): Promise<void>
{
	const state = getDbState();
	state.closed = true;
	state.controller.abort();
	await state.scanPromise;
	const db = state.db;
	state.db = null;
	db?.close();
}
