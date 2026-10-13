let open = false;

const listeners = new Set<() => void>();

export function setKeyboardShortcutsOpen(next: boolean): void {
	if (open === next) return;
	open = next;
	for (const listener of listeners) listener();
}

export function subscribeKeyboardShortcutsOpen(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getKeyboardShortcutsOpen(): boolean {
	return open;
}

export function getServerKeyboardShortcutsOpen(): boolean {
	return false;
}
