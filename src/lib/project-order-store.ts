import {useSyncExternalStore} from "react";

import {normalizeProjectOrder} from "./project-order";

/**
 * Per-browser folder (project) section order, like claude.ai/code's account-wide
 * `code-projects-order`: project names in their chosen order. Absent means A to Z.
 */
export const PROJECT_ORDER_STORAGE_KEY = "ccp-projects-order";

const EMPTY: readonly string[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: readonly string[] = EMPTY;

function readRaw(): string | null
{
	try
	{
		return localStorage.getItem(PROJECT_ORDER_STORAGE_KEY);
	}
	catch
	{
		return null;
	}
}

function parse(raw: string | null): readonly string[]
{
	if (raw === null) return EMPTY;
	try
	{
		const order = normalizeProjectOrder(JSON.parse(raw));
		return order.length === 0 ? EMPTY : order;
	}
	catch
	{
		return EMPTY;
	}
}

/** The stored order; absent, corrupt or unreadable storage yields none. */
export function readProjectOrder(): readonly string[]
{
	const raw = readRaw();
	if (raw !== cachedRaw)
	{
		cachedRaw = raw;
		cachedState = parse(raw);
	}
	return cachedState;
}

function notify(): void
{
	for (const listener of listeners) listener();
}

/** Store a new folder order. */
export function setProjectOrder(order: readonly string[]): void
{
	try
	{
		localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(order));
	}
	catch
	{
		// Storage can be denied or full; the order is best-effort per browser.
	}
	notify();
}

/** Upstream `ye` (Sort A to Z): forget the stored order. */
export function resetProjectOrder(): void
{
	try
	{
		localStorage.removeItem(PROJECT_ORDER_STORAGE_KEY);
	}
	catch
	{
		// As above.
	}
	notify();
}

function onStorage(event: StorageEvent): void
{
	if (event.key === null || event.key === PROJECT_ORDER_STORAGE_KEY) notify();
}

function subscribe(listener: () => void): () => void
{
	if (listeners.size === 0) window.addEventListener("storage", onStorage);
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
		if (listeners.size === 0) window.removeEventListener("storage", onStorage);
	};
}

function getServerSnapshot(): readonly string[]
{
	return EMPTY;
}

/** The live folder order for this browser, kept in sync across tabs. */
export function useProjectOrder(): readonly string[]
{
	return useSyncExternalStore(subscribe, readProjectOrder, getServerSnapshot);
}
