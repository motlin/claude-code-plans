import {watch} from 'chokidar';
import type {ServerResponse} from 'node:http';
import type {FSWatcher} from 'chokidar';

const clients = new Set<ServerResponse>();

let watcher: FSWatcher | null = null;

export function broadcast(): void {
	for (const client of clients) {
		client.write('event: content-updated\ndata: {}\n\n');
	}
}

export function addClient(res: ServerResponse): void {
	clients.add(res);
	res.on('close', () => {
		clients.delete(res);
	});
}

export function removeClient(res: ServerResponse): void {
	clients.delete(res);
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
		client.end();
	}
	clients.clear();
}
