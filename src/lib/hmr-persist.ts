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

/** `import.meta.hot.data` in dev (typed `any` by Vite), else the module-level cache. */
function persistentStore(): Record<string, unknown> {
	const hot: {data: Record<string, unknown>} | undefined = import.meta.hot;
	return hot ? hot.data : cache;
}

export function hmrPersist<T>(key: string, init: () => T): T {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the store is untyped; each key is only ever written by its own hmrPersist<T> call site
	return (persistentStore()[key] ??= init()) as T;
}

/** Remove and return the value persisted under `key`, if any, without creating one. */
export function hmrTake(key: string): unknown {
	const store = persistentStore();
	const value = store[key];
	Reflect.deleteProperty(store, key);
	return value;
}

/** Vite's HMR client awaits dispose callbacks, though its `dispose` type only admits `() => void`. */
interface AwaitingDisposeContext {
	dispose(cleanup: () => void | Promise<void>): void;
}

export function hmrDispose(cleanup: () => void | Promise<void>): void {
	const hot: AwaitingDisposeContext | undefined = import.meta.hot;
	hot?.dispose(cleanup);
}
