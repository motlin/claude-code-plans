import {useEffect, useSyncExternalStore} from "react";

/**
 * Rules for claude.ai/code's "Get notified when you're needed" tip under tool-approval cards,
 * copied from its bundle: the tip appears only once the user comes back after leaving the tab
 * for 30s while an approval waited, and counts toward a cap of three shows once it has been on
 * screen for a second, ignoring a repeat show within 10s of the last.
 */
export const NOTIFY_TIP_MAX_SHOWS = 3;
const NOTIFY_TIP_AWAY_MS = 30_000;
const NOTIFY_TIP_SEEN_MS = 1_000;
const NOTIFY_TIP_REPEAT_MS = 10_000;
/** How long "Notifications on" stays before the tip folds away. */
export const NOTIFY_TIP_ON_MS = 3_000;

const SHOWS_STORAGE_KEY = "ccp-tool-approval-notify-tip-shows";

interface NotifyTipShows {
	count: number;
	lastShownAt: number;
}

const NO_SHOWS: NotifyTipShows = {count: 0, lastShownAt: 0};

export function readNotifyTipShows(): NotifyTipShows {
	try {
		const raw = localStorage.getItem(SHOWS_STORAGE_KEY);
		if (raw === null) return NO_SHOWS;
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || !("count" in value) || typeof value.count !== "number") {
			return NO_SHOWS;
		}
		const lastShownAt = "lastShownAt" in value && typeof value.lastShownAt === "number" ? value.lastShownAt : 0;
		return {count: value.count, lastShownAt};
	} catch {
		return NO_SHOWS;
	}
}

function recordNotifyTipShown(now: number): void {
	const shows = readNotifyTipShows();
	const sinceLast = now - shows.lastShownAt;
	if (shows.count >= NOTIFY_TIP_MAX_SHOWS || (sinceLast >= 0 && sinceLast < NOTIFY_TIP_REPEAT_MS)) return;
	try {
		localStorage.setItem(SHOWS_STORAGE_KEY, JSON.stringify({count: shows.count + 1, lastShownAt: now}));
	} catch {
		// Storage unavailable: the tip may show again next time.
	}
}

interface TipTrigger {
	/** Set once the user came back after the away window; it holds for the session's later cards. */
	triggered: boolean;
	/** Whether this session's show was already counted. */
	seen: boolean;
	listeners: Set<() => void>;
}

const triggers = new Map<string, TipTrigger>();

function triggerFor(sessionId: string): TipTrigger {
	let trigger = triggers.get(sessionId);
	if (!trigger) {
		trigger = {triggered: false, seen: false, listeners: new Set()};
		triggers.set(sessionId, trigger);
	}
	return trigger;
}

function fire(trigger: TipTrigger): void {
	if (trigger.triggered) return;
	trigger.triggered = true;
	for (const listener of trigger.listeners) listener();
}

/** Forgets every session's trigger, as a fresh page load would. */
export function resetNotifyTipTriggers(): void {
	triggers.clear();
}

/**
 * True once the tab was hidden for the away window while `armed`; stays true for the session.
 * Arming watches visibility only while an approval card that could show the tip is mounted.
 */
export function useNotifyTipTrigger(sessionId: string, armed: boolean): boolean {
	const triggered = useSyncExternalStore(
		(listener) => {
			const trigger = triggerFor(sessionId);
			trigger.listeners.add(listener);
			return () => {
				trigger.listeners.delete(listener);
			};
		},
		() => triggers.get(sessionId)?.triggered ?? false,
		() => false,
	);

	useEffect(() => {
		const trigger = triggerFor(sessionId);
		if (!armed || trigger.triggered) return undefined;
		let hiddenAt: number | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onVisibility = () => {
			if (!document.hidden) {
				clearTimeout(timer);
				timer = undefined;
				if (hiddenAt !== null && Date.now() - hiddenAt >= NOTIFY_TIP_AWAY_MS) fire(trigger);
				hiddenAt = null;
				return;
			}
			hiddenAt ??= Date.now();
			timer ??= setTimeout(() => {
				fire(trigger);
			}, NOTIFY_TIP_AWAY_MS);
		};
		onVisibility();
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [sessionId, armed]);

	return triggered;
}

function subscribeVisibility(listener: () => void): () => void {
	document.addEventListener("visibilitychange", listener);
	return () => {
		document.removeEventListener("visibilitychange", listener);
	};
}

/** Counts the session's show once the tip has been on a visible page for a second. */
export function useCountNotifyTipShow(sessionId: string, showing: boolean): void {
	const visible = useSyncExternalStore(
		subscribeVisibility,
		() => !document.hidden,
		() => false,
	);
	useEffect(() => {
		if (!showing || !visible) return undefined;
		const timer = setTimeout(() => {
			const trigger = triggerFor(sessionId);
			if (trigger.seen) return;
			trigger.seen = true;
			recordNotifyTipShown(Date.now());
		}, NOTIFY_TIP_SEEN_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [sessionId, showing, visible]);
}
