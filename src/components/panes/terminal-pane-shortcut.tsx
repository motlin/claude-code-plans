import {useShortcut} from "../../hooks/use-shortcut";
import {assertNever} from "../../lib/assert-never";
import {usePaneHost} from "./pane-host-context";
import {terminalShortcutAction} from "./terminal-shortcut-action";

const TERMINAL_FOCUS_SELECTOR = '[data-pane-kind="terminal"] [data-terminal-focus]';

/** Set by ⌃` when it opens the pane, consumed on mount so the new pane takes focus. */
let pendingTerminalFocus = false;

/** Whether ⌃` just opened the Terminal pane; clears the request so only the pane it opened takes focus. */
export function consumePendingTerminalFocus(): boolean {
	const pending = pendingTerminalFocus;
	pendingTerminalFocus = false;
	return pending;
}

function focusTerminal(): void {
	document.querySelector<HTMLElement>(TERMINAL_FOCUS_SELECTOR)?.focus();
}

function isFocusInTerminal(): boolean {
	return document.activeElement?.closest('[data-pane-kind="terminal"]') != null;
}

/** ⌃` opens, focuses or closes the Terminal pane, kept apart from the pane's renderer so the cold load skips it. */
export function TerminalPaneShortcut({available}: {available: boolean}) {
	const host = usePaneHost();
	useShortcut("toggle_terminal", () => {
		const action = terminalShortcutAction({
			available,
			open: host.isOpen("terminal"),
			focusedTile: host.layout.focused,
			focusInTerminal: isFocusInTerminal(),
		});
		switch (action) {
			case "noop":
				return false;
			case "open":
				pendingTerminalFocus = true;
				host.openPane("terminal");
				return true;
			case "close":
				host.closePane("terminal");
				return true;
			case "focus":
			case "caret":
				focusTerminal();
				return true;
			default:
				return assertNever(action);
		}
	});
	return null;
}
