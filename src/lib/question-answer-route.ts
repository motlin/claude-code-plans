/**
 * Where a question card's answer goes: typed into the session's live herdr pane,
 * nowhere (the card is read-only and points at the terminal), or a resumed fork,
 * which only a session that no longer runs may take.
 */
export type QuestionAnswerRoute = "live-pane" | "read-only" | "fork";

export const READ_ONLY_ANSWER_HINT = "Answer in the terminal";
export const FORK_ANSWER_LABEL = "Answer in a new fork";

/**
 * The route for a session's question card. `live` and `hasLivePane` are null
 * while unknown, which keeps the card read-only: a live session is never forked.
 */
export function questionAnswerRoute({
	live,
	hasLivePane,
	writesEnabled,
}: {
	live: boolean | null;
	hasLivePane: boolean | null;
	writesEnabled: boolean;
}): QuestionAnswerRoute {
	if (hasLivePane === true) return writesEnabled ? "live-pane" : "read-only";
	if (live === false && hasLivePane === false) return "fork";
	return "read-only";
}
