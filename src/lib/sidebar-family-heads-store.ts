import {useSyncExternalStore} from "react";

/**
 * The fork-family heads the mounted session list shows (upstream `g0` inside the code
 * list root reads them through `sS`), so ⌘K can offer Hide/Show (all) nested sessions.
 * Null while no session list is mounted.
 */
let heads: readonly string[] | null = null;
let publisher: symbol | null = null;
const listeners = new Set<() => void>();

function emit(): void
{
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): readonly string[] | null
{
	return heads;
}

export function publishFamilyHeads(owner: symbol, ids: readonly string[]): void
{
	publisher = owner;
	heads = ids;
	emit();
}

/** Clears the heads only when `owner` published them, so a late unmount can't wipe a newer list. */
export function clearFamilyHeads(owner: symbol): void
{
	if (publisher !== owner) return;
	publisher = null;
	heads = null;
	emit();
}

export function useFamilyHeads(): readonly string[] | null
{
	return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export function resetFamilyHeadsStore(): void
{
	publisher = null;
	heads = null;
	emit();
}
