import {ack, ackedAt, clear} from "./awaiting-ack-store";
import {offerSessionUndo} from "./session-undo";
import {hasUnseenWork, isExplicitUnread, markSeen, markUnseen} from "./unread-store";

/**
 * Upstream shared-19 `U0`: Mark as completed acks the row at `ackMs` and marks it read, and returns its `undoLocal`.
 * The restore puts back the earlier ack (or clears it) only while the ack is still the one written here, then marks
 * the row unread again if it was: explicitly for a hand Mark as unread, plainly otherwise. Upstream's cloud
 * `completedAckAt` restamp has no local analogue.
 */
export function markCompletedWithUndo(sessionId: string, ackMs: number): () => void
{
	const previousAck = ackedAt(sessionId);
	const wasUnseen = hasUnseenWork(sessionId);
	const wasExplicit = isExplicitUnread(sessionId);
	markSeen(sessionId);
	ack(sessionId, ackMs);
	return () =>
	{
		if (ackedAt(sessionId) === ackMs)
		{
			if (previousAck === undefined) clear(sessionId);
			else ack(sessionId, previousAck);
		}
		if (wasUnseen)
			markUnseen(
				sessionId,
				{
					explicit: wasExplicit,
				},
			);
	};
}

/** Upstream cd9c8436e `Pi`: completes the row and offers its restore to the session-undo stack as a `complete` entry. */
export function markCompleted(sessionId: string, ackMs: number): void
{
	offerSessionUndo(
		{
			kind: "complete",
			sessionIds: [sessionId],
			restore: markCompletedWithUndo(sessionId, ackMs),
		},
	);
}
