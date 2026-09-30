import {useSyncExternalStore} from "react";

/**
 * Per-browser dismissal of the composer's weekly pace banner: the weekly reset (epoch seconds)
 * it was dismissed for. The banner stays hidden until that reset passes.
 */
const PACE_BANNER_STORAGE_KEY = "ccp-usage-pace-dismissed-until";

const listeners = new Set<() => void>();
/** Used when storage is unreadable, so a dismissal still holds for this page load. */
let memoryDismissedUntil: number | null = null;

export function readPaceBannerDismissedUntil(): number | null {
	let raw: string | null;
	try {
		raw = localStorage.getItem(PACE_BANNER_STORAGE_KEY);
	} catch {
		return memoryDismissedUntil;
	}
	if (raw === null) return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

export function writePaceBannerDismissedUntil(resetsAt: number): void {
	memoryDismissedUntil = resetsAt;
	try {
		localStorage.setItem(PACE_BANNER_STORAGE_KEY, String(resetsAt));
	} catch {
		// Storage unavailable: the in-memory value covers this page load.
	}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === PACE_BANNER_STORAGE_KEY) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

export function usePaceBannerDismissedUntil(): number | null {
	return useSyncExternalStore(subscribe, readPaceBannerDismissedUntil, () => null);
}
