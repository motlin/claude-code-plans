import {watch} from 'chokidar';
import type {FSWatcher} from 'chokidar';
import {getDb} from './db';
import {indexFile} from './db/indexer';

const clients = new Set<ReadableStreamDefaultController>();
const encoder = new TextEncoder();

let watcher: FSWatcher | null = null;
let projectsDir = '';

export function broadcast(): void {
	const data = encoder.encode('event: content-updated\ndata: {}\n\n');
	for (const client of clients) {
		try {
			client.enqueue(data);
		} catch {
			clients.delete(client);
		}
	}
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

	if (ext === '.jsonl') {
		if (jsonlDebounceTimer) clearTimeout(jsonlDebounceTimer);
		jsonlDebounceTimer = setTimeout(async () => {
			try {
				const {index} = getDb();
				await indexFile(index, path, projectsDir);
			} catch {
				// indexing error, still broadcast for UI refresh
			}
			broadcast();
			jsonlDebounceTimer = null;
		}, JSONL_DEBOUNCE_MS);
	} else if (ext === '.json' && path.endsWith('sessions-index.json')) {
		(async () => {
			try {
				const {index} = getDb();
				await indexFile(index, path, projectsDir);
			} catch {
				// indexing error
			}
			broadcast();
		})();
	} else if (ext === '.md') {
		broadcast();
	}
}

export function createWatcher(dirs: string[], projDir?: string): FSWatcher {
	if (projDir) projectsDir = projDir;

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
