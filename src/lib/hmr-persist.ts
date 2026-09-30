/**
 * HMR-safe state persistence utilities.
 *
 * In dev: `import.meta.hot.data` persists values across Vite HMR reloads,
 * scoped to the importing module. In production: `import.meta.hot` is
 * undefined, so a module-scoped cache object lives for the process lifetime
 * (no HMR reloads occur).
 *
 * `hmrDispose` wraps `import.meta.hot.dispose()` -- called automatically
 * before the old module is replaced. Use it for cleanup (closing watchers,
 * clearing timers) instead of defensive check-and-close at re-init time.
 */

const cache: Record<string, unknown> = {};

export function hmrPersist<T>(key: string, init: () => T): T {
	if (import.meta.hot) {
		return (import.meta.hot.data[key] ??= init()) as T;
	}
	return (cache[key] ??= init()) as T;
}

/** Remove and return the value persisted under `key`, if any, without creating one. */
export function hmrTake(key: string): unknown {
	const store: Record<string, unknown> = import.meta.hot ? import.meta.hot.data : cache;
	const value = store[key];
	delete store[key];
	return value;
}

export function hmrDispose(cleanup: () => void | Promise<void>): void {
	import.meta.hot?.dispose(cleanup);
}
