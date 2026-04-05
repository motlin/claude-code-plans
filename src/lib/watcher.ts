import {watch} from 'chokidar';
import type {FSWatcher} from 'chokidar';
import {getDb} from './db';
import {indexFile} from './db/indexer';
import {SSE_EVENTS, deriveEventFromPath, type SseEvent} from './hook-events';

// Persist mutable state on globalThis so it survives Vite HMR reloads.
// Without this, each reload creates fresh module-scoped variables while the
// old watcher, timers, and SSE clients leak in the previous module closure.
interface WatcherGlobals {
	__watcherClients: Set<ReadableStreamDefaultController>;
	__watcher: FSWatcher | null;
	__watcherProjectsDir: string;
	__watcherPlansDir: string;
	__watcherStatuslineDir: string;
	__jsonlDebounceTimer: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as Partial<WatcherGlobals>;
if (!g.__watcherClients) g.__watcherClients = new Set();

const encoder = new TextEncoder();

const WATCHED_EXTENSIONS = new Set(['.md', '.jsonl', '.json']);
const JSONL_DEBOUNCE_MS = 5000;

export function broadcastTyped(type: string, data: Record<string, unknown>): void {
	const payload = encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	for (const client of g.__watcherClients!) {
		try {
			client.enqueue(payload);
		} catch {
			g.__watcherClients!.delete(client);
		}
	}
}

export function broadcastEvent(event: SseEvent): void {
	broadcastTyped(event.type, event.data);
}

export function broadcast(): void {
	broadcastTyped(SSE_EVENTS.CONTENT_UPDATED, {});
}

export function addClient(controller: ReadableStreamDefaultController): void {
	g.__watcherClients!.add(controller);
}

export function removeClient(controller: ReadableStreamDefaultController): void {
	g.__watcherClients!.delete(controller);
}

export function getClientCount(): number {
	return g.__watcherClients!.size;
}

function handleFileChange(path: string): void {
	const ext = path.slice(path.lastIndexOf('.'));
	if (!WATCHED_EXTENSIONS.has(ext)) return;

	const event = deriveEventFromPath(path, g.__watcherPlansDir ?? '', g.__watcherProjectsDir ?? '');

	if (ext === '.jsonl') {
		if (g.__jsonlDebounceTimer) clearTimeout(g.__jsonlDebounceTimer);
		g.__jsonlDebounceTimer = setTimeout(async () => {
			try {
				const {index} = getDb();
				await indexFile(index, path, g.__watcherProjectsDir ?? '');
			} catch {
				// indexing error, still broadcast for UI refresh
			}
			broadcastEvent(event);
			g.__jsonlDebounceTimer = null;
		}, JSONL_DEBOUNCE_MS);
	} else if (ext === '.json' && g.__watcherStatuslineDir && path.startsWith(g.__watcherStatuslineDir)) {
		const filename = path.split('/').pop() ?? '';
		const sessionId = filename.replace(/\.json$/, '');
		broadcastTyped(SSE_EVENTS.STATUSLINE_UPDATED, {sessionId});
	} else if (ext === '.json' && path.includes('/tasks/')) {
		(async () => {
			try {
				const {index} = getDb();
				await indexFile(index, path, g.__watcherProjectsDir ?? '');
			} catch {
				// indexing error
			}
			broadcast();
		})();
	} else if (ext === '.json' && path.endsWith('sessions-index.json')) {
		(async () => {
			try {
				const {index} = getDb();
				await indexFile(index, path, g.__watcherProjectsDir ?? '');
			} catch {
				// indexing error
			}
			broadcastEvent(event);
		})();
	} else if (ext === '.json') {
		broadcastEvent(event);
	} else if (ext === '.md') {
		broadcastEvent(event);
	}
}

export function createWatcher(dirs: string[], projDir?: string, plDir?: string, slDir?: string): FSWatcher {
	if (projDir) g.__watcherProjectsDir = projDir;
	if (plDir) g.__watcherPlansDir = plDir;
	if (slDir) g.__watcherStatuslineDir = slDir;

	// Close previous watcher on HMR reload
	if (g.__watcher) {
		g.__watcher.close();
	}

	g.__watcher = watch(dirs, {
		ignoreInitial: true,
		awaitWriteFinish: {stabilityThreshold: 300, pollInterval: 100},
		usePolling: true,
		interval: 1000,
	});

	g.__watcher.on('add', handleFileChange);
	g.__watcher.on('change', handleFileChange);
	g.__watcher.on('unlink', handleFileChange);

	return g.__watcher;
}

export async function closeWatcher(): Promise<void> {
	if (g.__watcher) {
		await g.__watcher.close();
		g.__watcher = null;
	}
	if (g.__jsonlDebounceTimer) {
		clearTimeout(g.__jsonlDebounceTimer);
		g.__jsonlDebounceTimer = null;
	}
	for (const client of g.__watcherClients!) {
		try {
			client.close();
		} catch {
			// already closed
		}
	}
	g.__watcherClients!.clear();
}
