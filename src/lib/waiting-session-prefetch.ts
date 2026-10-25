import type {ActiveSessionListItem} from "./api/sessions";

/** How many waiting sessions one pass warms; each costs a transcript tail, its detail and its subagents. */
export const WAITING_PREFETCH_LIMIT = 4;

/**
 * The sessions waiting on the reader that are worth loading before they are clicked: not the open one, not one this
 * page already warmed, longest-waiting first (an undated wait last), at most WAITING_PREFETCH_LIMIT.
 */
export function waitingSessionsToPrefetch(
	sessions: ReadonlyArray<Pick<ActiveSessionListItem, "sessionId" | "state" | "blockedSince">>,
	{openSessionId, warmed}: {openSessionId: string | undefined; warmed: ReadonlySet<string>},
): string[] {
	return sessions
		.filter(
			(session) =>
				session.state === "waiting" && session.sessionId !== openSessionId && !warmed.has(session.sessionId),
		)
		.toSorted((a, b) => (a.blockedSince ?? "￿").localeCompare(b.blockedSince ?? "￿"))
		.slice(0, WAITING_PREFETCH_LIMIT)
		.map((session) => session.sessionId);
}
