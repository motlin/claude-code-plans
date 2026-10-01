/**
 * "Find in file" from a file tab's context menu: the tab may not be showing
 * yet, so a request no mounted viewer takes waits for that file's viewer to
 * mount.
 */

type FindHandler = (path: string) => boolean;

const handlers = new Set<FindHandler>();
let pending: string | null = null;

export function requestFindInFile(path: string): void {
	pending = path;
	for (const handler of handlers) {
		if (handler(path)) pending = null;
	}
}

/** Registers a viewer; it takes a pending request for its file straight away. */
export function registerFindInFile(path: string, open: () => void): () => void {
	if (pending === path) {
		pending = null;
		open();
	}
	const handler: FindHandler = (requested) => {
		if (requested !== path) return false;
		open();
		return true;
	};
	handlers.add(handler);
	return () => {
		handlers.delete(handler);
	};
}
