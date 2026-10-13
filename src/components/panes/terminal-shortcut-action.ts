import type {TileId} from "../../lib/pane-layout";

export type TerminalShortcutAction = "noop" | "open" | "focus" | "close" | "caret";

/**
 * Upstream's ⌃` state machine: nothing without a transport, open a closed
 * pane, pull focus over from another tile, close when focus is already inside
 * the terminal, and otherwise put the caret back into the active terminal.
 */
export function terminalShortcutAction({
	available,
	open,
	focusedTile,
	focusInTerminal,
}: {
	available: boolean;
	open: boolean;
	focusedTile: TileId;
	focusInTerminal: boolean;
}): TerminalShortcutAction {
	if (!available) return "noop";
	if (!open) return "open";
	if (focusInTerminal) return "close";
	if (focusedTile !== "terminal") return "focus";
	return "caret";
}
