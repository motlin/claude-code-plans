import {sessionStateKind, type ActivityState, type DisplayState, type WaitHeat} from "../lib/session-state";
import {SessionStateIcon} from "./status-dot";

const DISPLAY_STATE_STYLES: Record<DisplayState, string> = {
	waiting: "text-amber-500",
	review: "text-sky-500",
	working: "text-green-500",
	idle: "text-t6",
	unknown: "text-t6",
};

const WAIT_HEAT_STYLES: Record<Exclude<WaitHeat, "">, string> = {
	warm: "text-amber-600",
	hot: "text-red-500",
};

/**
 * Fixed two-column grid so the icon and the status word land at the same x on
 * every row of a session list, regardless of which label the row shows. The icon
 * is the upstream row icon for the display state; the word carries the activity
 * itself, coloured by the wait heat (how long the session has been blocked).
 */
export function SessionStatusIndicator({
	displayState,
	heat,
	state,
}: {
	displayState: DisplayState;
	heat: WaitHeat;
	state: ActivityState;
}) {
	const wordStyle = heat === "" ? DISPLAY_STATE_STYLES[state] : WAIT_HEAT_STYLES[heat];
	return (
		<span
			className="grid grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-1.5 text-xs"
			aria-label={`Session status: ${state}`}
		>
			<SessionStateIcon kind={sessionStateKind(displayState)} />
			<span className={`truncate ${wordStyle}`}>{state}</span>
		</span>
	);
}
