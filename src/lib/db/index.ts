import {openAppDb, type AppDb} from "./connection";
import {fullScan, scanFileContentRoots} from "./indexer";
import {hmrPersist, hmrTake} from "../hmr-persist";
import {isRecord} from "../narrow";
import {homedir} from "node:os";
import {join} from "node:path";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const TASKS_DIR = join(homedir(), ".claude", "tasks");
const PLANS_DIR = join(homedir(), ".claude", "plans");

// Holds the in-flight initial scan so concurrent callers await the same
// fullScan instead of racing two scans on the same DB. Two concurrent scans
// corrupt orphan-session inserts with SQLITE_CONSTRAINT_PRIMARYKEY because
// indexJsonlFile's existingSession check straddles async file I/O.
// `appDbScanPromise` (memoized via hmrPersist) is the single source of truth
// for the in-flight scan promise; runInitialScan/awaitInitialScan are the
// only entrypoints. The holder pattern lets awaitInitialScan() observe
// whether a scan has been started without forcing one to start.

type ScanHolder =
{
	promise: Promise<void> | null;
	/** Settles when the session/plan index scan ends, before the slower file-content scan. */
	indexPromise: Promise<void> | null;
	/** The file-content scan has ended, so content search covers every indexed root. */
	fileContentScanDone: boolean;
	controller: AbortController;
};
type DbHolder =
{
	db: AppDb | null;
};

// An instance that predates the abort controller left a holder without one in
// the HMR state, and its scan cannot be aborted, so give the holder a fresh one.
function getScanHolder(): ScanHolder
{
	const holder = hmrPersist<Partial<ScanHolder>>("appDbScanPromise", () => ({}));
	return Object.assign(
		holder,
		{
			promise: holder.promise ?? null,
			indexPromise: holder.indexPromise ?? null,
			fileContentScanDone: holder.fileContentScanDone ?? false,
			controller: holder.controller ?? new AbortController(),
		},
	);
}

function isClosable(value: unknown): value is Pick<AppDb, "close">
{
	return isRecord(value) && typeof value["close"] === "function";
}

function getDbHolder(): DbHolder
{
	return hmrPersist<DbHolder>("appDbHolder", () => (
	{
		db: null,
	}));
}

export function getDb(): AppDb
{
	const holder = getDbHolder();
	return (holder.db ??= openAppDb());
}

export async function initDb(): Promise<AppDb>
{
	return Promise.resolve(getDb());
}

// Each scan step waits out another connection's write lock on its own
// (retryWhileBusy), and shutdownDb() stops a restarting server's scan before
// the next instance starts, so a failure that reaches here is final: log it
// and let startup continue.
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
	const holder = getScanHolder();
	if (holder.promise === null)
	{
		const {signal} = holder.controller;
		const indexPromise = runScan("Initial database scan", signal, async () =>
		{
			const db = getDb();
			await fullScan(db.index, db.summaries, PROJECTS_DIR, TASKS_DIR, PLANS_DIR, undefined, signal);
		});
		holder.indexPromise = indexPromise;
		holder.promise = (async () =>
		{
			await indexPromise;
			const db = getDb();
			await runScan("Initial file-content scan", signal, async () =>
				scanFileContentRoots(db.index, fileContentRoots, ignoredDirNames, signal),
			);
			holder.fileContentScanDone = true;
		})();
	}
	return holder.promise;
}

export async function awaitInitialScan(): Promise<void>
{
	return getScanHolder().promise ?? Promise.resolve();
}

/**
 * Settles once the initial session/plan index scan ends, without waiting for
 * the file-content scan: transcript events queued behind that slower scan left
 * a session created during startup unindexed for minutes.
 */
export async function awaitInitialIndexScan(): Promise<void>
{
	const holder = getScanHolder();
	return holder.indexPromise ?? holder.promise ?? Promise.resolve();
}

/** Whether the initial file-content scan has ended, so content search no longer misses unscanned files. */
export function isFileContentScanDone(): boolean
{
	return getScanHolder().fileContentScanDone;
}

/** Aborts when shutdownDb() begins, so startup work can stop before the DB closes under it. */
export function getShutdownSignal(): AbortSignal
{
	return getScanHolder().controller.signal;
}

/**
 * Stops the initial scan and closes the databases, so a restarted server's
 * scan never contends with this instance for the write lock.
 */
export async function shutdownDb(): Promise<void>
{
	const scanHolder = getScanHolder();
	scanHolder.controller.abort();
	await scanHolder.promise;
	const dbHolder = getDbHolder();
	const db = dbHolder.db;
	dbHolder.db = null;
	db?.close();
	// Instances that predate the holder kept their connection under `appDb`.
	const legacyDb = hmrTake("appDb");
	if (isClosable(legacyDb)) legacyDb.close();
}
