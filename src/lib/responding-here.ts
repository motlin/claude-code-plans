import type {SessionSummaryState} from "./session-state";
import type {WorkingMarkerState} from "./working-marker";

export interface RespondingHereSignal
{
	/** The working line's turn state. A question wait reads "idle" here, a permission wait "waiting". */
	status: WorkingMarkerState["status"];
	/** The hooks' session state; "waiting" while a prompt waits on the user. */
	sessionState: SessionSummaryState | null;
	/** This page sent a prompt or an answer that has not reached the transcript yet. */
	sending: boolean;
}

/**
 * Upstream's `isResponding` half `d`: the tab holds an open `pendingTurn`, armed by a send from this tab or by a
 * stream event it receives, and kept in memory until the turn ends. Locally: this page saw the turn working (or
 * sent it), and it has not stopped since; a wait on the user keeps whatever the page already knew.
 */
export function nextRespondingHere(prev: boolean, {status, sessionState, sending}: RespondingHereSignal): boolean
{
	if (sending || status === "working" || status === "stopping" || status === "retrying") return true;
	if (status === "waiting" || sessionState === "waiting") return prev;
	return false;
}
