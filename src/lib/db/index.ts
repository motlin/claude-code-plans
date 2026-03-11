import {openAppDb, type AppDb} from './connection';
import {fullScan} from './indexer';
import {homedir} from 'node:os';
import {join} from 'node:path';

let _appDb: AppDb | null = null;

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

export function getDb(): AppDb {
	if (!_appDb) {
		_appDb = openAppDb();
	}
	return _appDb;
}

export async function initDb(): Promise<AppDb> {
	const db = getDb();
	await fullScan(db.index, PROJECTS_DIR);
	return db;
}

export {type AppDb} from './connection';
