/**
 * Tiny TTL-based dedupe set shared by the watcher (`src/lib/watcher.ts`) and
 * the hook dispatcher (`src/lib/hook-dispatcher.ts`). When Claude Code fires a
 * `PostToolUse` hook for an LLM edit, both paths race to broadcast the same
 * SSE delta: the hook dispatcher first (low latency), then chokidar a couple
 * hundred ms later once `awaitWriteFinish` clears.
 *
 * Callers ask `recentlyBroadcast(key, ttlMs)` immediately before they would
 * `broadcastTyped(...)`. The first call within a TTL window records the
 * timestamp and returns `false` (broadcast proceeds). Subsequent calls within
 * the window return `true` (caller suppresses the broadcast). The timestamp
 * is not refreshed on subsequent calls, so a long-lived storm naturally
 * re-broadcasts after each window elapses.
 *
 * Key shape (by convention): `${domainEventName}:${primaryId}:${mtimeOrCountSignal}`
 * The signal at the end (mtime, message count, etc.) is what changes between
 * distinct events so two genuinely different updates don't collide.
 *
 * HMR-safe: the underlying map is registered with `hmrPersist` so the watcher
 * and dispatcher continue to share state across dev hot-reloads.
 */
import {hmrPersist} from './hmr-persist';

const lastSeen = hmrPersist('updateDedupeLastSeen', () => new Map<string, number>());

/**
 * Returns true if `key` was last seen within `ttlMs` of `now`. Otherwise
 * records `now` as the last-seen timestamp for `key` and returns false.
 *
 * Callers should treat a `true` return as "another path already broadcast
 * this; skip" and a `false` return as "go ahead and broadcast".
 */
export function recentlyBroadcast(key: string, ttlMs: number): boolean {
	const now = Date.now();
	const previous = lastSeen.get(key);
	if (previous !== undefined && now - previous < ttlMs) {
		return true;
	}
	lastSeen.set(key, now);
	pruneExpired(now, ttlMs);
	return false;
}

/**
 * Drop entries whose last-seen timestamp is older than `ttlMs`. Called
 * opportunistically from `recentlyBroadcast` so the map can't grow without
 * bound under steady traffic. Pruning is O(n) but n is bounded by the number
 * of distinct keys broadcast within the window — small in practice.
 */
function pruneExpired(now: number, ttlMs: number): void {
	for (const [key, ts] of lastSeen) {
		if (now - ts >= ttlMs) lastSeen.delete(key);
	}
}

export const __testing = {
	clear: (): void => {
		lastSeen.clear();
	},
};
