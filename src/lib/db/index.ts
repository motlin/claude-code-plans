import {openAppDb, type AppDb} from './connection';
import {fullScan} from './indexer';
import {hmrPersist} from '../hmr-persist';
import {homedir} from 'node:os';
import {join} from 'node:path';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const TASKS_DIR = join(homedir(), '.claude', 'tasks');
const PLANS_DIR = join(homedir(), '.claude', 'plans');

// Holds the in-flight initial scan so concurrent callers (e.g. getDb() and
// initDb()) await the same fullScan instead of racing two scans on the same
// DB. Two concurrent scans corrupt orphan-session inserts with
// SQLITE_CONSTRAINT_PRIMARYKEY because indexJsonlFile's existingSession check
// straddles async file I/O.
function startInitialScan(db: AppDb): Promise<void> {
	return hmrPersist('appDbScanPromise', () =>
		fullScan(db.index, PROJECTS_DIR, TASKS_DIR, PLANS_DIR).catch((err) => {
			console.error('Initial database scan failed:', err);
		}),
	);
}

export function getDb(): AppDb {
	return hmrPersist('appDb', () => {
		const db = openAppDb();
		void startInitialScan(db);
		return db;
	});
}

export async function initDb(): Promise<AppDb> {
	const db = getDb();
	await startInitialScan(db);
	return db;
}
