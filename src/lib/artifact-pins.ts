import {useSyncExternalStore} from "react";
import {z} from "zod";

/** Per-browser artifact pins, keyed by the claude.ai artifact URL, in pin order. */
export const ARTIFACT_PIN_STORAGE_KEY = "ccp-artifact-pins";

const ArtifactPinsSchema = z.array(z.string());

const EMPTY: readonly string[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedPins: readonly string[] = EMPTY;

function readRaw(): string | null {
	try {
		return localStorage.getItem(ARTIFACT_PIN_STORAGE_KEY);
	} catch {
		return null;
	}
}

function parse(raw: string | null): readonly string[] {
	if (raw === null) return EMPTY;
	try {
		const result = ArtifactPinsSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data : EMPTY;
	} catch {
		return EMPTY;
	}
}

/** Current pins; absent, corrupt or unreadable storage yields none. */
export function readArtifactPins(): readonly string[] {
	const raw = readRaw();
	if (raw !== cachedRaw) {
		cachedRaw = raw;
		cachedPins = parse(raw);
	}
	return cachedPins;
}

function write(pins: readonly string[]): void {
	try {
		localStorage.setItem(ARTIFACT_PIN_STORAGE_KEY, JSON.stringify(pins));
	} catch {
		// Storage can be denied or full; pins are best-effort per browser.
	}
	for (const listener of listeners) listener();
}

export function isArtifactPinned(url: string): boolean {
	return readArtifactPins().includes(url);
}

export function pinArtifact(url: string): void {
	const pins = readArtifactPins();
	if (!pins.includes(url)) write([...pins, url]);
}

export function unpinArtifact(url: string): void {
	write(readArtifactPins().filter((pinned) => pinned !== url));
}

function onStorage(event: StorageEvent): void {
	if (event.key === null || event.key === ARTIFACT_PIN_STORAGE_KEY) {
		for (const listener of listeners) listener();
	}
}

function subscribe(listener: () => void): () => void {
	if (listeners.size === 0) window.addEventListener("storage", onStorage);
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) window.removeEventListener("storage", onStorage);
	};
}

function getServerSnapshot(): readonly string[] {
	return EMPTY;
}

export interface ArtifactPinsSnapshot {
	pinned: readonly string[];
	isPinned: (url: string) => boolean;
}

/** Live artifact pins for this browser, kept in sync across tabs via the `storage` event. */
export function useArtifactPins(): ArtifactPinsSnapshot {
	const pinned = useSyncExternalStore(subscribe, readArtifactPins, getServerSnapshot);
	return {pinned, isPinned: (url) => pinned.includes(url)};
}
