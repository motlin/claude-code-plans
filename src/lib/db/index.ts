import {openAppDb, type AppDb} from './connection';
import {fullScan} from './indexer';
import {homedir} from 'node:os';
import {join} from 'node:path';

// Store on globalThis so the singleton survives Vite HMR reloads.
// Without this, each HMR reload creates a new module scope with _appDb = null,
// opening new SQLite connections while the old ones leak.
const g = globalThis as unknown as {__appDb?: AppDb};

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const TASKS_DIR = join(homedir(), '.claude', 'tasks');
const PLANS_DIR = join(homedir(), '.claude', 'plans');

export function getDb(): AppDb {
	if (!g.__appDb) {
		g.__appDb = openAppDb();
	}
	return g.__appDb;
}

export async function initDb(): Promise<AppDb> {
	const db = getDb();
	await fullScan(db.index, PROJECTS_DIR, TASKS_DIR, PLANS_DIR);
	return db;
}

export {type AppDb} from './connection';
