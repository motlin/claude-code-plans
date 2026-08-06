import { openAppDb, type AppDb } from "./connection";
import { fullScan, scanFileContentRoots } from "./indexer";
import { hmrPersist } from "../hmr-persist";
import { homedir } from "node:os";
import { join } from "node:path";

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

type ScanHolder = { promise: Promise<void> | null };

function getScanHolder(): ScanHolder {
  return hmrPersist<ScanHolder>("appDbScanPromise", () => ({ promise: null }));
}

export function getDb(): AppDb {
  return hmrPersist("appDb", () => openAppDb());
}

export async function initDb(): Promise<AppDb> {
  return getDb();
}

export function runInitialScan(
  fileContentRoots: readonly string[] = [],
  ignoredDirNames: ReadonlySet<string> = new Set(),
): Promise<void> {
  const holder = getScanHolder();
  if (holder.promise === null) {
    holder.promise = (async () => {
      const db = getDb();
      try {
        await fullScan(db.index, db.summaries, PROJECTS_DIR, TASKS_DIR, PLANS_DIR);
      } catch (err) {
        console.error("Initial database scan failed:", err);
      }
      try {
        await scanFileContentRoots(db.index, fileContentRoots, ignoredDirNames);
      } catch (err) {
        console.error("Initial file-content scan failed:", err);
      }
    })();
  }
  return holder.promise;
}

export function awaitInitialScan(): Promise<void> {
  return getScanHolder().promise ?? Promise.resolve();
}
