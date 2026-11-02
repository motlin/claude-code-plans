import type {SessionListItem} from "./api/sessions";

/**
 * Upstream `Ss`'s `acked → idle`: a blocked row acked at or after its mtime ("Mark as completed") draws as
 * finished — Ready for review with an open PR, else Idle — unless this tab holds its approval card live
 * (`hasLiveApproval` beats the ack). `state` is kept so the responding overlay (`withAnsweredHold`) still applies
 * after it. Any other row, or one the ack doesn't cover, comes back as the same object.
 */
export function withAwaitingAck(
	session: SessionListItem,
	ackedAtMs: number | undefined,
	liveApproval: boolean,
): SessionListItem
{
	if (session.bucket !== "blocked" || liveApproval) return session;
	if (ackedAtMs === undefined || ackedAtMs < Date.parse(session.mtime)) return session;
	const {awaitingPermission: _awaiting, unseenError: _error, erroredAt: _erroredAt, ...rest} = session;
	const prState = session.prStatus?.state;
	return {
		...rest,
		bucket: prState === "open" || prState === "draft" ? "review" : "done",
	};
}
