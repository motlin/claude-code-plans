import type {PendingElicitation} from "./domain-event-payload-schemas";
import {hmrPersist} from "./hmr-persist";

/**
 * The MCP elicitations each session waits on, oldest first, keyed by session
 * id. The CLI writes an elicitation nowhere on disk, so only the `Elicitation`
 * hook's payload can describe it; HMR-persisted so dev hot-swaps keep it.
 */
const store = hmrPersist("pendingElicitations", () => new Map<string, PendingElicitation[]>());

export function addPendingElicitation(sessionId: string, entry: PendingElicitation): void {
	store.set(sessionId, [...(store.get(sessionId) ?? []), entry]);
}

/**
 * Drop the elicitation an `ElicitationResult` answers: the one with its id, or
 * the oldest from its server when the result carries no id. True when one was removed.
 */
export function resolvePendingElicitation(
	sessionId: string,
	result: {elicitationId?: string; serverName: string},
): boolean {
	const entries = store.get(sessionId) ?? [];
	const index = entries.findIndex((entry) =>
		result.elicitationId === undefined
			? entry.serverName === result.serverName
			: entry.elicitationId === result.elicitationId,
	);
	if (index === -1) return false;
	const remaining = entries.toSpliced(index, 1);
	if (remaining.length === 0) store.delete(sessionId);
	else store.set(sessionId, remaining);
	return true;
}

/** Forget every elicitation of the session; true when there was one. */
export function clearPendingElicitations(sessionId: string): boolean {
	return store.delete(sessionId);
}

export function getPendingElicitations(sessionId: string): PendingElicitation[] {
	return store.get(sessionId) ?? [];
}

export function getAllPendingElicitations(): Record<string, PendingElicitation[]> {
	return Object.fromEntries(store);
}

/** Forget every pending elicitation, as a fresh process starts. */
export function clearAllPendingElicitations(): void {
	store.clear();
}
