/**
 * HMR-safe state utilities.
 *
 * Vite HMR re-executes module-level code, wiping module-scoped variables like
 * `new Set()` or `new Map()`. Storing them on `globalThis` with a stable key
 * lets the values survive reloads during development without affecting
 * production behavior.
 */

const GLOBAL_KEY = '__claude_code_plans_hmr_state__' as const;

type GlobalWithHmrState = typeof globalThis & {
	[GLOBAL_KEY]?: Record<string, unknown>;
};

function getStore(): Record<string, unknown> {
	const g = globalThis as GlobalWithHmrState;
	if (!g[GLOBAL_KEY]) {
		g[GLOBAL_KEY] = {};
	}
	return g[GLOBAL_KEY];
}

/**
 * Returns a Set<T> that survives Vite HMR reloads. The same `key` always
 * returns the same Set instance within a browser tab.
 */
export function hmrSet<T>(key: string): Set<T> {
	const store = getStore();
	if (!store[key]) {
		store[key] = new Set<T>();
	}
	return store[key] as Set<T>;
}

/**
 * Returns a Map<K,V> that survives Vite HMR reloads.
 */
export function hmrMap<K, V>(key: string): Map<K, V> {
	const store = getStore();
	if (!store[key]) {
		store[key] = new Map<K, V>();
	}
	return store[key] as Map<K, V>;
}
