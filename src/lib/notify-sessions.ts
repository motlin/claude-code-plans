import {useSyncExternalStore} from "react";

/**
 * Per-browser "Notify me" opt-ins: the sessions that raise browser notifications even when the
 * global Settings ▸ Notifications switches are off.
 */
const NOTIFY_SESSIONS_STORAGE_KEY = "ccp-notify-sessions";

const listeners = new Set<() => void>();
/** Used when storage is unreadable, so an opt-in still holds for this page load. */
let memorySessions: ReadonlySet<string> = new Set();
let cachedRaw: string | null = null;
let cachedSessions: ReadonlySet<string> = new Set();

function parse(raw: string | null): ReadonlySet<string> {
	if (raw === null) return new Set();
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? new Set(value.filter((id): id is string => typeof id === "string")) : new Set();
	} catch {
		return new Set();
	}
}

export function readNotifySessions(): ReadonlySet<string> {
	let raw: string | null;
	try {
		raw = localStorage.getItem(NOTIFY_SESSIONS_STORAGE_KEY);
	} catch {
		return memorySessions;
	}
	// Keeps the snapshot referentially stable for useSyncExternalStore.
	if (raw !== cachedRaw) {
		cachedRaw = raw;
		cachedSessions = parse(raw);
	}
	return cachedSessions;
}

export function isSessionNotifyOptedIn(sessionId: string): boolean {
	return readNotifySessions().has(sessionId);
}

export function optInSessionNotifications(sessionId: string): void {
	const next = new Set(readNotifySessions()).add(sessionId);
	memorySessions = next;
	try {
		localStorage.setItem(NOTIFY_SESSIONS_STORAGE_KEY, JSON.stringify([...next]));
	} catch {
		// Storage unavailable: the in-memory set covers this page load.
	}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === NOTIFY_SESSIONS_STORAGE_KEY) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

export function useSessionNotifyOptedIn(sessionId: string): boolean {
	return useSyncExternalStore(
		subscribe,
		() => isSessionNotifyOptedIn(sessionId),
		() => false,
	);
}
