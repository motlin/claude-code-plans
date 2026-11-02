import {useCallback, useSyncExternalStore} from "react";

/**
 * Upstream's client-only transcript rows: a host-intercepted `/status` or `/usage` (`injectClientRows`)
 * appends a user row with the command as sent plus its card. They live only in the in-memory bucket, so
 * they survive navigating within the app and are gone after a reload; each send adds another pair.
 * Locally they sit after the transcript line that was last when they were sent (`afterUuid`), so later
 * turns draw below them; a null or vanished anchor draws them at the end.
 */
export type ClientRowKind = "status" | "usage";

export interface ClientRow
{
	id: string;
	kind: ClientRowKind;
	/** The user row's text: the command as sent ("/status", "/cost"). */
	text: string;
	/** The uuid of the transcript line the rows follow. */
	afterUuid: string | null;
	createdAt: number;
}

const NO_ROWS: readonly ClientRow[] = [];
const rowsBySession = new Map<string, readonly ClientRow[]>();
const listeners = new Set<() => void>();
let sequence = 0;

function notify(): void
{
	for (const listener of listeners) listener();
}

export function subscribeClientRows(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

export function readClientRows(sessionId: string): readonly ClientRow[]
{
	return rowsBySession.get(sessionId) ?? NO_ROWS;
}

export function appendClientRow(
	sessionId: string,
	{kind, text, afterUuid}: Pick<ClientRow, "kind" | "text" | "afterUuid">,
	now: number = Date.now(),
): ClientRow
{
	sequence += 1;
	const row: ClientRow =
	{
		id: `client-${kind}-${now}-${sequence}`,
		kind,
		text,
		afterUuid,
		createdAt: now,
	};
	rowsBySession.set(sessionId, [...readClientRows(sessionId), row]);
	notify();
	return row;
}

/** Drops every session's rows, as a reload does. */
export function clearClientRows(): void
{
	rowsBySession.clear();
	sequence = 0;
	notify();
}

export function useClientRows(sessionId: string): readonly ClientRow[]
{
	const read = useCallback(() => readClientRows(sessionId), [sessionId]);
	return useSyncExternalStore(subscribeClientRows, read, () => NO_ROWS);
}
