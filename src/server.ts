import * as Sentry from '@sentry/node';

if (import.meta.env.DEV) {
	Sentry.init({
		dsn: 'https://spotlight@local/0',
		tracesSampleRate: 1.0,
	});
}

import handler, {createServerEntry} from '@tanstack/react-start/server-entry';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createWatcher} from './lib/watcher';
import {initDb, runInitialScan} from './lib/db';
import {startSweep} from './lib/active-session-store';
import {getCacheDir} from './lib/db/connection';

const PLANS_DIR = join(homedir(), '.claude', 'plans');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const COMMANDS_DIR = join(homedir(), '.claude', 'commands');
const PLUGINS_DIR = join(homedir(), '.claude', 'plugins', 'cache');
const TASKS_DIR = join(homedir(), '.claude', 'tasks');
const STATUSLINE_DIR = join(getCacheDir(), 'statusline');

void (async () => {
	try {
		await initDb();
	} catch (err) {
		console.error('Failed to initialize database:', err);
		return;
	}

	let watcher;
	try {
		watcher = await createWatcher(
			[PLANS_DIR, PROJECTS_DIR, COMMANDS_DIR, PLUGINS_DIR, TASKS_DIR, STATUSLINE_DIR],
			PROJECTS_DIR,
			PLANS_DIR,
			STATUSLINE_DIR,
		);
	} catch (err) {
		console.error('Failed to create watcher:', err);
		return;
	}

	await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));

	try {
		await runInitialScan(PLANS_DIR);
	} catch (err) {
		console.error('Initial scan failed:', err);
	}

	startSweep();
})();

export default createServerEntry({
	fetch(request) {
		return handler.fetch(request);
	},
});
