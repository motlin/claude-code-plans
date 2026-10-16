import {useSessionRailShown} from "../../lib/session-rail-store";
import {usePhoneSheet} from "../../lib/use-phone-sheet";
import {useOptionalPaneHost} from "../panes/pane-host-context";

/**
 * Whether the rail docks beside the chat: shown, at desktop width, and with no
 * side pane open. A pane and the rail share the right side, so opening one swaps
 * the rail out and closing it brings the rail back.
 */
export function useSessionRailDocked(): boolean {
	const shown = useSessionRailShown();
	const phone = usePhoneSheet();
	const host = useOptionalPaneHost();
	return shown && !phone && (host?.openKinds.length ?? 0) === 0;
}
