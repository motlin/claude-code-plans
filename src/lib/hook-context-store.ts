import {hmrPersist} from "./hmr-persist";
import type {SessionHookContextPayload} from "./hook-events";

/**
 * Each session's latest hook context (turn settings, Stop's background tasks and
 * crons), merged the way the client merges `session:hook-context-changed`. It is
 * kept apart from the active-session store, which only a SessionStart hook
 * fills, so a tab that connects later still learns what is running.
 */
const contexts = hmrPersist("hookContextStore", () => new Map<string, SessionHookContextPayload>());

export function recordHookContext(update: SessionHookContextPayload): void {
	contexts.set(update.sessionId, {...(contexts.get(update.sessionId) ?? {sessionId: update.sessionId}), ...update});
}

export function forgetHookContext(sessionId: string): void {
	contexts.delete(sessionId);
}

export function getHookContexts(): ReadonlyMap<string, SessionHookContextPayload> {
	return contexts;
}

export function clearHookContexts(): void {
	contexts.clear();
}
