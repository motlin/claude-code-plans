/**
 * HMR-safe state persistence utilities.
 *
 * In dev: values live in one store on `globalThis`, so they survive Vite HMR
 * reloads and are shared by every instance of a module. One dev worker thread
 * evaluates server modules more than once (the nitro WebSocket routes and the
 * TanStack Start entry run in separate module runners, each with its own
 * `import.meta.hot.data`), and state one instance writes, such as the herdr
 * server registry and pane tables the event bridge keeps, must be visible to
 * the others. In production and tests: `import.meta.hot` is undefined, so a
 * module-scoped cache object lives for the process lifetime (no HMR reloads
 * occur) and `vi.resetModules()` starts it fresh.
 *
 * `hmrDispose` wraps `import.meta.hot.dispose()` -- called automatically
 * before the old module is replaced. Use it for cleanup (closing watchers,
 * clearing timers) instead of defensive check-and-close at re-init time.
 */

const cache: Record<string, unknown> = {};

const SHARED_STORE_KEY = Symbol.for("claude-code-browser.hmr-persist");

/** The shared `globalThis` store when `hot` is defined (dev), else the module-level cache. */
export function hmrStoreFor(hot: object | undefined, scope: object = globalThis): Record<string, unknown> {
	if (hot === undefined) return cache;
	const existing: unknown = Reflect.get(scope, SHARED_STORE_KEY);
	if (existing !== null && typeof existing === "object") {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only this function writes the shared store
		return existing as Record<string, unknown>;
	}
	const store: Record<string, unknown> = {};
	Reflect.set(scope, SHARED_STORE_KEY, store);
	return store;
}

function persistentStore(): Record<string, unknown> {
	const hot: object | undefined = import.meta.hot;
	return hmrStoreFor(hot);
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
