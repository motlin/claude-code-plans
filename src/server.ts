import handler, {createServerEntry} from '@tanstack/react-start/server-entry';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createWatcher} from './lib/watcher';

const PLANS_DIR = process.env['PLANS_DIR'] ?? join(homedir(), '.claude', 'plans');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

createWatcher([PLANS_DIR, PROJECTS_DIR]);

export default createServerEntry({
	fetch(request) {
		return handler.fetch(request);
	},
});
