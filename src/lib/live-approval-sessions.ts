import {useEffect, useSyncExternalStore} from "react";

/**
 * Sessions whose approval, question or plan card this tab draws live — upstream's `hasLiveApproval` (`E6`), a
 * pending request held by this tab's own session subscription. A live approval beats a "Mark as completed" ack
 * and hides that item. Registrations are counted, so two cards for one session need two disposes.
 */

const EMPTY: ReadonlySet<string> = new Set();
const counts = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = EMPTY;

function emitChange(): void
{
	snapshot = counts.size === 0 ? EMPTY : new Set(counts.keys());
	for (const listener of listeners) listener();
}

/** Mark the session's approval live in this tab; the returned dispose releases this registration once. */
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
		if (count <= 1) counts.delete(sessionId);
		else counts.set(sessionId, count - 1);
		emitChange();
	};
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

/** Registers the session's approval as live while `live` holds. */
export function useLiveApproval(sessionId: string, live: boolean): void
{
	useEffect(() => (live ? registerLiveApproval(sessionId) : undefined), [sessionId, live]);
}

export const __liveApprovalTesting =
{
	reset(): void
	{
		counts.clear();
		emitChange();
	},
};
