import {useCallback, useSyncExternalStore} from "react";
import {z} from "zod";

/**
 * Upstream's durable pending-message store (`session-pending-messages`, zustand persist) cut down to the
 * part a local send needs: the sends the pane refused, per session, kept in localStorage so a
 * "Not delivered" row survives a reload until it is retried or discarded.
 */
export interface FailedSend
{
	id: string;
	prompt: string;
	/** ISO time of the first attempt; a retry that fails again keeps it, like upstream's pending timestamp. */
	sentAt: string;
}

const FailedSendsSchema = z.array(
	z.object(
		{
			id: z.string(),
			prompt: z.string(),
			sentAt: z.string(),
		},
	),
);

const STORAGE_PREFIX = "ccp-failed-sends:";
const EMPTY: readonly FailedSend[] = [];
const cache = new Map<string, readonly FailedSend[]>();
const listeners = new Set<() => void>();

function storage(): Storage | null
{
	if (typeof window === "undefined") return null;
	try
	{
		return window.localStorage;
	}
	catch
	{
		return null;
	}
}

/** The session's refused sends, oldest first. */
export function readFailedSends(sessionId: string): readonly FailedSend[]
{
	const cached = cache.get(sessionId);
	if (cached !== undefined) return cached;
	let sends: readonly FailedSend[] = EMPTY;
	try
	{
		const raw = storage()?.getItem(`${STORAGE_PREFIX}${sessionId}`);
		const parsed = raw == null ? null : FailedSendsSchema.safeParse(JSON.parse(raw));
		if (parsed?.success === true && parsed.data.length > 0) sends = parsed.data;
	}
	catch
	{
		sends = EMPTY;
	}
	cache.set(sessionId, sends);
	return sends;
}

function writeFailedSends(sessionId: string, sends: readonly FailedSend[]): void
{
	cache.set(sessionId, sends.length === 0 ? EMPTY : sends);
	try
	{
		const key = `${STORAGE_PREFIX}${sessionId}`;
		if (sends.length === 0) storage()?.removeItem(key);
		else storage()?.setItem(key, JSON.stringify(sends));
	}
	catch
	{
		// Quota or blocked storage: the row still shows for this page.
	}
	for (const listener of listeners) listener();
}

/** Upstream `markPendingFailed`: the send stays as a "Not delivered" row; a retried id keeps its place. */
export function addFailedSend(sessionId: string, send: FailedSend): void
{
	const sends = readFailedSends(sessionId);
	if (sends.some((existing) => existing.id === send.id)) return;
	writeFailedSends(
		sessionId,
		[...sends, send].toSorted((a, b) => a.sentAt.localeCompare(b.sentAt)),
	);
}

/** Upstream `discardFailedSend`: the row goes. */
export function removeFailedSend(sessionId: string, id: string): void
{
	const sends = readFailedSends(sessionId);
	if (!sends.some((send) => send.id === id)) return;
	writeFailedSends(
		sessionId,
		sends.filter((send) => send.id !== id),
	);
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

/** Forgets the in-memory copy, so the next read comes from storage (tests and other tabs). */
export function resetFailedSendCache(): void
{
	cache.clear();
}

export function useFailedSends(sessionId: string): readonly FailedSend[]
{
	const getSnapshot = useCallback(() => readFailedSends(sessionId), [sessionId]);
	return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
