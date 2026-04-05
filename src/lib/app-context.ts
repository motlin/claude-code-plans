import {watch} from 'chokidar';
import type {FSWatcher} from 'chokidar';
import {openAppDb, type AppDb} from './db/connection';
import {fullScan} from './db/indexer';
import type {ActiveSessionEntry} from './active-session-store';

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface AppContextConfig {
	projectsDir: string;
	plansDir: string;
	commandsDir: string;
	pluginsDir: string;
	tasksDir: string;
	statuslineDir: string;
}

export interface AppContext {
	db: AppDb;
	watcher: FSWatcher;
	sseClients: Set<ReadableStreamDefaultController>;
	sessionStore: Map<string, ActiveSessionEntry>;
	sweepTimer: ReturnType<typeof setInterval>;
	config: AppContextConfig;
}

export async function createAppContext(config: AppContextConfig): Promise<AppContext> {
	const db = openAppDb();
	await fullScan(db.index, config.projectsDir, config.tasksDir);

	const sseClients = new Set<ReadableStreamDefaultController>();
	const sessionStore = new Map<string, ActiveSessionEntry>();

	const watcher = watch(
		[
			config.plansDir,
			config.projectsDir,
			config.commandsDir,
			config.pluginsDir,
			config.tasksDir,
			config.statuslineDir,
		],
		{
			ignoreInitial: true,
			awaitWriteFinish: {stabilityThreshold: 300, pollInterval: 100},
			usePolling: true,
			interval: 1000,
		},
	);

	const sweepTimer = setInterval(() => {
		const now = Date.now();
		for (const [id, entry] of sessionStore) {
			if (now - entry.lastActivity > STALE_THRESHOLD_MS) {
				sessionStore.delete(id);
			}
		}
	}, SWEEP_INTERVAL_MS);

	return {db, watcher, sseClients, sessionStore, sweepTimer, config};
}

export async function disposeAppContext(ctx: AppContext): Promise<void> {
	clearInterval(ctx.sweepTimer);
	await ctx.watcher.close();

	for (const client of ctx.sseClients) {
		try {
			client.close();
		} catch {
			// already closed
		}
	}
	ctx.sseClients.clear();
	ctx.sessionStore.clear();
	ctx.db.close();
}
