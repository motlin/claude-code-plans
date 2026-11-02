import {useState, useSyncExternalStore} from "react";

/** Upstream's `Wu`: how long a promoted queued message stays "landed" (ca8b34310 store `X`). */
const LANDED_MS = 1500;

interface LandedMark
{
	/** The {@link markCount} this mark was made at. */
	seq: number;
	timer: ReturnType<typeof setTimeout>;
}

/*
 * Upstream keys `landed` by the message uuid. A local prompt gets its JSONL uuid only once the
 * CLI writes it, so the mark is keyed by the prompt text and flashes rows mounted after it.
 */
const marks = new Map<string, LandedMark>();
const listeners = new Set<() => void>();
/** Marks made so far: a row that mounts at count `n` flashes for marks numbered `n` and before. */
let markCount = 0;

function emit(): void
{
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

/** Upstream `Zu`: marks a promoted prompt landed for {@link LANDED_MS}. */
export function markLanded(text: string): void
{
	const previous = marks.get(text);
	if (previous !== undefined) clearTimeout(previous.timer);
	const timer = setTimeout(() =>
	{
		marks.delete(text);
		emit();
	}, LANDED_MS);
	markCount += 1;
	marks.set(
		text,
		{
			seq: markCount,
			timer,
		},
	);
	emit();
}

export function isLanded(text: string): boolean
{
	return marks.has(text);
}

/** Drops every mark; for tests. */
export function clearLanded(): void
{
	for (const mark of marks.values()) clearTimeout(mark.timer);
	marks.clear();
	emit();
}

/**
 * True while `text` is landed and this row mounted at or after the mark, so the row the promoted
 * prompt becomes flashes and rows already on screen with the same text do not.
 */
export function useLanded(text: string): boolean
{
	const [mountedAt] = useState(() => markCount);
	return useSyncExternalStore(
		subscribe,
		() =>
		{
			const mark = marks.get(text);
			return mark !== undefined && mark.seq <= mountedAt;
		},
		() => false,
	);
}

/** Upstream's per-session promote announcement: "sent" on accept, "read" once landed. */
export interface PromoteAnnouncement
{
	kind: "sent" | "read";
	seq: number;
}

const announcements = new Map<string, PromoteAnnouncement>();

/** Upstream `markAccepted` / `markLanded`'s `announcements[sessionId] = {kind, seq + 1}`. */
export function announce(sessionId: string, kind: PromoteAnnouncement["kind"]): void
{
	announcements.set(
		sessionId,
		{
			kind,
			seq: (announcements.get(sessionId)?.seq ?? 0) + 1,
		},
	);
	emit();
}

export function peekAnnouncement(sessionId: string): PromoteAnnouncement | undefined
{
	return announcements.get(sessionId);
}

/** Drops every announcement; for tests. */
export function clearAnnouncements(): void
{
	announcements.clear();
	emit();
}

/** Upstream `useAnnouncement(sessionId)`. */
export function useAnnouncement(sessionId: string): PromoteAnnouncement | undefined
{
	return useSyncExternalStore(
		subscribe,
		() => announcements.get(sessionId),
		() => undefined,
	);
}
