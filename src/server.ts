import handler, {createServerEntry} from '@tanstack/react-start/server-entry';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createWatcher} from './lib/watcher';
import {initDb} from './lib/db';
import {startSweep} from './lib/active-session-store';
import {getCacheDir} from './lib/db/connection';

const PLANS_DIR = process.env['PLANS_DIR'] ?? join(homedir(), '.claude', 'plans');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const COMMANDS_DIR = join(homedir(), '.claude', 'commands');
const PLUGINS_DIR = join(homedir(), '.claude', 'plugins', 'cache');
const TASKS_DIR = join(homedir(), '.claude', 'tasks');
const STATUSLINE_DIR = join(getCacheDir(), 'statusline');

initDb().catch((err) => {
	console.error('Failed to initialize database:', err);
});

createWatcher(
	[PLANS_DIR, PROJECTS_DIR, COMMANDS_DIR, PLUGINS_DIR, TASKS_DIR, STATUSLINE_DIR],
	PROJECTS_DIR,
	PLANS_DIR,
	STATUSLINE_DIR,
);
startSweep();

export default createServerEntry({
	fetch(request) {
		return handler.fetch(request);
	},
});
