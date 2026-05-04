import {openAppDb, type AppDb} from './connection';
import {fullScan} from './indexer';
import {hmrPersist} from '../hmr-persist';
import {homedir} from 'node:os';
import {join} from 'node:path';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const TASKS_DIR = join(homedir(), '.claude', 'tasks');
const PLANS_DIR = join(homedir(), '.claude', 'plans');

function startInitialScan(db: AppDb): Promise<void> {
	return hmrPersist('appDbScanPromise', () =>
		fullScan(db.index, PROJECTS_DIR, TASKS_DIR).catch((err) => {
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
	await fullScan(db.index, PROJECTS_DIR, TASKS_DIR, PLANS_DIR);
	return db;
}
