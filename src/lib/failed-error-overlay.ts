import type {SessionListItem} from "./api/sessions";
import {isFailedUnacked} from "./failed-row";

/**
 * Upstream `Q$`: a failed row draws the error state, read or not and whether or not its CLI still runs, until
 * Mark as completed acks it (`ack >= updated_at` or `ack >= errorAt`). An acked row loses the server's unseen error
 * and draws finished: Ready for review with an open PR, else Idle. Archived, working and gated rows, and
 * rows with no `failedAt` (`withAwaitingAck` alone clears their server error) come back as the same object.
 */
export function withFailedError(session: SessionListItem, ackedAtMs: number | undefined): SessionListItem
{
	if (
		session.archived ||
		session.bucket === "working" ||
		session.state === "waiting" ||
		session.awaitingPermission === true ||
		session.failedAt === undefined
	)
		return session;
	if (isFailedUnacked(session, ackedAtMs))
	{
		if (session.bucket === "blocked" && session.unseenError === true) return session;
		return {
			...session,
			bucket: "blocked",
			unseenError: true,
			erroredAt: session.failedAt,
		};
	}
	if (session.unseenError !== true) return session;
	const {unseenError: _error, erroredAt: _erroredAt, ...rest} = session;
	const prState = session.prStatus?.state;
	return {
		...rest,
		bucket: prState === "open" || prState === "draft" ? "review" : "done",
	};
}
