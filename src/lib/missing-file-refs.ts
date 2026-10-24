/**
 * Upstream's `missingFiles`: per-session paths whose open found no file. A
 * transcript ref to one renders as blocked code with the missing reason.
 */
const missingBySession = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

const NONE: ReadonlySet<string> = new Set();

export function missingFileRefs(sessionId: string): ReadonlySet<string> {
	return missingBySession.get(sessionId) ?? NONE;
}

export function markFileRefMissing(sessionId: string, path: string): void {
	const current = missingFileRefs(sessionId);
	if (current.has(path)) return;
	missingBySession.set(sessionId, new Set([...current, path]));
	for (const listener of listeners) listener();
}

export function subscribeMissingFileRefs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
