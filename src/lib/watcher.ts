import {watch} from 'chokidar';
import type {FSWatcher} from 'chokidar';

const clients = new Set<ReadableStreamDefaultController>();
const encoder = new TextEncoder();

let watcher: FSWatcher | null = null;

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

export function createWatcher(dirs: string[]): FSWatcher {
	watcher = watch(dirs, {
		ignoreInitial: true,
		awaitWriteFinish: {stabilityThreshold: 300, pollInterval: 100},
	});

	watcher.on('add', (path) => {
		if (path.endsWith('.md')) broadcast();
	});
	watcher.on('change', (path) => {
		if (path.endsWith('.md')) broadcast();
	});
	watcher.on('unlink', (path) => {
		if (path.endsWith('.md')) broadcast();
	});

	return watcher;
}

export async function closeWatcher(): Promise<void> {
	if (watcher) {
		await watcher.close();
		watcher = null;
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
