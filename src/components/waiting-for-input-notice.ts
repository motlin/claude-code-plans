import type {SessionSummaryState} from "../lib/session-state";

/**
 * Whether the dock shows the waiting notice: the session waits on input (from
 * the CLI registry or hooks) but no question or permission card can dock. The
 * CLI writes a pending AskUserQuestion to the transcript only once answered, so
 * upstream's docked question card has nothing local to render from.
 */
export function showsWaitingForInputNotice({
	state,
	hasDockedCard,
}: {
	state: SessionSummaryState | null;
	hasDockedCard: boolean;
}): boolean {
	return state === "waiting" && !hasDockedCard;
}
