import {openAppDb, type AppDb} from "./connection";
import {isBusyError} from "./busy";
import {fullScan, scanFileContentRoots} from "./indexer";
import {hmrPersist, hmrTake} from "../hmr-persist";
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

type ScanHolder = {promise: Promise<void> | null; controller: AbortController};
type DbHolder = {db: AppDb | null};

// An instance that predates the abort controller left a holder without one in
// the HMR state, and its scan cannot be aborted, so give the holder a fresh one.
function getScanHolder(): ScanHolder {
	const holder = hmrPersist<Partial<ScanHolder>>("appDbScanPromise", () => ({}));
	holder.promise ??= null;
	holder.controller ??= new AbortController();
	return holder as ScanHolder;
}

function getDbHolder(): DbHolder {
	return hmrPersist<DbHolder>("appDbHolder", () => ({db: null}));
}

export function getDb(): AppDb {
	const holder = getDbHolder();
	return (holder.db ??= openAppDb());
}

export async function initDb(): Promise<AppDb> {
	return getDb();
}

// A restarted dev server can start its scan while the previous instance's
// scan still holds the write lock, and the busy timeout can lose that race.
// Both scans skip files already indexed at their current mtime, so running
// one again resumes it rather than redoing it.
const BUSY_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000];

async function runScanWithRetry(label: string, signal: AbortSignal, scan: () => Promise<void>): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		if (signal.aborted) return;
		try {
			await scan();
			return;
		} catch (err) {
			if (signal.aborted) return;
			const delayMs = BUSY_RETRY_DELAYS_MS[attempt];
			if (delayMs === undefined || !isBusyError(err)) {
				console.error(`${label} failed:`, err);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
}

export function runInitialScan(
	fileContentRoots: readonly string[] = [],
	ignoredDirNames: ReadonlySet<string> = new Set(),
): Promise<void> {
	const holder = getScanHolder();
	if (holder.promise === null) {
		const {signal} = holder.controller;
		holder.promise = (async () => {
			const db = getDb();
			await runScanWithRetry("Initial database scan", signal, () =>
				fullScan(db.index, db.summaries, PROJECTS_DIR, TASKS_DIR, PLANS_DIR, undefined, signal),
			);
			await runScanWithRetry("Initial file-content scan", signal, () =>
				scanFileContentRoots(db.index, fileContentRoots, ignoredDirNames, signal),
			);
		})();
	}
	return holder.promise;
}

export function awaitInitialScan(): Promise<void> {
	return getScanHolder().promise ?? Promise.resolve();
}

/**
 * Stops the initial scan and closes the databases, so a restarted server's
 * scan never contends with this instance for the write lock.
 */
export async function shutdownDb(): Promise<void> {
	const scanHolder = getScanHolder();
	scanHolder.controller.abort();
	await scanHolder.promise;
	const dbHolder = getDbHolder();
	const db = dbHolder.db;
	dbHolder.db = null;
	db?.close();
	// Instances that predate the holder kept their connection under `appDb`.
	const legacyDb = hmrTake("appDb") as AppDb | undefined;
	legacyDb?.close();
}
