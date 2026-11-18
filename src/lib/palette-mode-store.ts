import {useSyncExternalStore} from "react";

export type PaletteMode = "search" | "compose";

/**
 * Upstream's remembered Search | Compose tab (`LSS-cmdk-mode`, a `sync: true` store). The local key keeps the
 * bare-string value: the origins differ, so no key is shared, but the store follows other tabs like upstream's.
 */
export const PALETTE_MODE_STORAGE_KEY = "cmdk-mode";

const listeners = new Set<() => void>();
// Storage can be unavailable (private mode); a switch is still remembered for this visit.
let memoryMode: PaletteMode = "search";

function notify(): void
{
	for (const listener of listeners) listener();
}

export function getPaletteModeSnapshot(): PaletteMode
{
	try
	{
		return localStorage.getItem(PALETTE_MODE_STORAGE_KEY) === "compose" ? "compose" : "search";
	}
	catch
	{
		return memoryMode;
	}
}

/** Upstream `sP` writes on every remembered switch, re-picks included. */
export function setRememberedPaletteMode(mode: PaletteMode): void
{
	memoryMode = mode;
	try
	{
		localStorage.setItem(PALETTE_MODE_STORAGE_KEY, mode);
	}
	catch
	{
		// Kept in memory above.
	}
	notify();
}

function onStorage(event: StorageEvent): void
{
	if (event.key === null || event.key === PALETTE_MODE_STORAGE_KEY) notify();
}

export function subscribePaletteMode(listener: () => void): () => void
{
	if (listeners.size === 0) window.addEventListener("storage", onStorage);
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
		if (listeners.size === 0) window.removeEventListener("storage", onStorage);
	};
}

function getServerSnapshot(): PaletteMode
{
	return "search";
}

/** The remembered tab; Search on the server and in the hydrate pass, like upstream's absent snapshot. */
export function usePaletteMode(): PaletteMode
{
	return useSyncExternalStore(subscribePaletteMode, getPaletteModeSnapshot, getServerSnapshot);
}
