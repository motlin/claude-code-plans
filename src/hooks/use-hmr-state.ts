import {useCallback, useSyncExternalStore} from 'react';
import {hmrMap} from '../lib/hmr-state';

/**
 * A React hook that behaves like `useState` but persists values in a
 * globalThis-backed Map so they survive Vite HMR reloads.
 *
 * Each piece of state is identified by a stable `key` (e.g. a tool-call id
 * or source uuid). The `initialValue` is only used when no persisted value
 * exists for that key.
 *
 * In production builds HMR never fires, so this degrades to a slightly
 * heavier useState -- acceptable for dev-experience wins.
 */

type Listener = () => void;
const listeners = hmrMap<string, Set<Listener>>('hmrStateListeners');

function getListeners(storeKey: string): Set<Listener> {
	let set = listeners.get(storeKey);
	if (!set) {
		set = new Set();
		listeners.set(storeKey, set);
	}
	return set;
}

function notify(storeKey: string) {
	const set = listeners.get(storeKey);
	if (set) {
		for (const fn of set) fn();
	}
}

const stores = hmrMap<string, Map<string, unknown>>('hmrStateStores');

function getStore(namespace: string): Map<string, unknown> {
	let store = stores.get(namespace);
	if (!store) {
		store = new Map();
		stores.set(namespace, store);
	}
	return store;
}

export function useHmrState<T>(
	namespace: string,
	key: string,
	initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
	const store = getStore(namespace);
	const fullKey = `${namespace}:${key}`;

	const subscribe = useCallback(
		(onStoreChange: Listener) => {
			const set = getListeners(fullKey);
			set.add(onStoreChange);
			return () => {
				set.delete(onStoreChange);
			};
		},
		[fullKey],
	);

	const getSnapshot = useCallback((): T => {
		if (store.has(key)) {
			return store.get(key) as T;
		}
		return initialValue;
	}, [store, key, initialValue]);

	const value = useSyncExternalStore(subscribe, getSnapshot, () => initialValue);

	const setValue = useCallback(
		(next: T | ((prev: T) => T)) => {
			const current = store.has(key) ? (store.get(key) as T) : initialValue;
			const resolved = typeof next === 'function' ? (next as (prev: T) => T)(current) : next;
			store.set(key, resolved);
			notify(fullKey);
		},
		[store, key, fullKey, initialValue],
	);

	return [value, setValue];
}
