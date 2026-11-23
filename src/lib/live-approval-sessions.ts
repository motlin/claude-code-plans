import {useEffect, useSyncExternalStore} from "react";

/**
 * Sessions whose approval, question or plan card this tab draws live — upstream's `hasLiveApproval` (`E6`), a
 * pending request held by this tab's own session subscription. A live approval beats a "Mark as completed" ack
 * and hides that item. Registrations are counted, so two cards for one session need two disposes.
 *
 * Upstream's request stores keep a pending request until it resolves or is swept, not while a card is mounted, so
 * leaving the session's page keeps the approval live. The last dispose therefore holds the id until
 * `releaseLiveApprovals` drops it: the card's own resolve, or the sessions list reporting the session no longer
 * waiting. Module state, so a full reload clears it, as upstream's does.
 */

const EMPTY: ReadonlySet<string> = new Set();
const counts = new Map<string, number>();
const held = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = EMPTY;

function emitChange(): void
{
	snapshot = counts.size === 0 && held.size === 0 ? EMPTY : new Set([...counts.keys(), ...held]);
	for (const listener of listeners) listener();
}

/** Mark the session's approval live in this tab; the returned dispose drops this registration once, the last into the hold. */
export function registerLiveApproval(sessionId: string): () => void
{
	counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
	emitChange();
	let disposed = false;
	return () =>
	{
		if (disposed) return;
		disposed = true;
		const count = counts.get(sessionId) ?? 0;
		if (count <= 1)
		{
			counts.delete(sessionId);
			held.add(sessionId);
		}
		else counts.set(sessionId, count - 1);
		emitChange();
	};
}

/** Drops the hold on these sessions; a still-mounted card keeps its own registration. */
export function releaseLiveApprovals(sessionIds: Iterable<string>): void
{
	let changed = false;
	for (const sessionId of sessionIds) changed = held.delete(sessionId) || changed;
	if (changed) emitChange();
}

export function liveApprovalIds(): ReadonlySet<string>
{
	return snapshot;
}

export function subscribeLiveApprovals(listener: () => void): () => void
{
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The ids of every session with a live approval in this tab; the same empty set while none has. */
export function useLiveApprovalIds(): ReadonlySet<string>
{
	return useSyncExternalStore(subscribeLiveApprovals, liveApprovalIds, () => EMPTY);
}

/**
 * Registers the session's approval as live while `live` holds. Unmounting keeps the hold (the request is still
 * pending); the card going away while mounted means it resolved, so that releases the hold.
 */
export function useLiveApproval(sessionId: string, live: boolean): void
{
	useEffect(() =>
	{
		if (live) return registerLiveApproval(sessionId);
		releaseLiveApprovals([sessionId]);
		return undefined;
	}, [sessionId, live]);
}

export const __liveApprovalTesting =
{
	reset(): void
	{
		counts.clear();
		held.clear();
		emitChange();
	},
};
