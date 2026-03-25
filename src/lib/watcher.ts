import {watch} from 'chokidar';
import type {FSWatcher} from 'chokidar';
import {getDb} from './db';
import {indexFile} from './db/indexer';
import {SSE_EVENTS, deriveEventFromPath, type SseEvent} from './hook-events';

const clients = new Set<ReadableStreamDefaultController>();
const encoder = new TextEncoder();

let watcher: FSWatcher | null = null;
let projectsDir = '';
let plansDir = '';

export function broadcastTyped(type: string, data: Record<string, unknown>): void {
	const payload = encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	for (const client of clients) {
		try {
			client.enqueue(payload);
		} catch {
			clients.delete(client);
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
	clients.add(controller);
}

export function removeClient(controller: ReadableStreamDefaultController): void {
	clients.delete(controller);
}

export function getClientCount(): number {
	return clients.size;
}

const WATCHED_EXTENSIONS = new Set(['.md', '.jsonl', '.json']);

let jsonlDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const JSONL_DEBOUNCE_MS = 5000;

function handleFileChange(path: string): void {
	const ext = path.slice(path.lastIndexOf('.'));
	if (!WATCHED_EXTENSIONS.has(ext)) return;

	const event = deriveEventFromPath(path, plansDir, projectsDir);

	if (ext === '.jsonl') {
		if (jsonlDebounceTimer) clearTimeout(jsonlDebounceTimer);
		jsonlDebounceTimer = setTimeout(async () => {
			try {
				const {index} = getDb();
				await indexFile(index, path, projectsDir);
			} catch {
				// indexing error, still broadcast for UI refresh
			}
			broadcastEvent(event);
			jsonlDebounceTimer = null;
		}, JSONL_DEBOUNCE_MS);
	} else if (ext === '.json' && path.includes('/tasks/')) {
		(async () => {
			try {
				const {index} = getDb();
				await indexFile(index, path, projectsDir);
			} catch {
				// indexing error
			}
			broadcast();
		})();
	} else if (ext === '.json' && path.endsWith('sessions-index.json')) {
		(async () => {
			try {
				const {index} = getDb();
				await indexFile(index, path, projectsDir);
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

export function createWatcher(dirs: string[], projDir?: string, plDir?: string): FSWatcher {
	if (projDir) projectsDir = projDir;
	if (plDir) plansDir = plDir;

	watcher = watch(dirs, {
		ignoreInitial: true,
		awaitWriteFinish: {stabilityThreshold: 300, pollInterval: 100},
		usePolling: true,
		interval: 1000,
	});

	watcher.on('add', handleFileChange);
	watcher.on('change', handleFileChange);
	watcher.on('unlink', handleFileChange);

	return watcher;
}

export async function closeWatcher(): Promise<void> {
	if (watcher) {
		await watcher.close();
		watcher = null;
	}
	if (jsonlDebounceTimer) {
		clearTimeout(jsonlDebounceTimer);
		jsonlDebounceTimer = null;
	}
	for (const client of clients) {
		try {
			client.close();
		} catch {
			// already closed
		}
	}
	clients.clear();
}
