import {useSessionRailShown} from "../../lib/session-rail-store";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {useOptionalPaneHost} from "../panes/pane-host-context";

/**
 * Whether the rail shows: toggled on and with no side pane open. A pane and the
 * rail share the right side, so opening one swaps the rail out and closing it
 * brings the rail back.
 */
export function useSessionRailVisible(): boolean {
	const shown = useSessionRailShown();
	const host = useOptionalPaneHost();
	return shown && (host?.openKinds.length ?? 0) === 0;
}

/** Whether the rail docks beside the chat: visible at desktop width. On a phone it floats over the transcript instead. */
export function useSessionRailDocked(): boolean {
	const visible = useSessionRailVisible();
	const phone = usePhoneSheet();
	return visible && !phone;
}
