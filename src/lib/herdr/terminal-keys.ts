import {bindingsFor, isMacPlatform, isWindowsPlatform, matchBinding} from "../shortcuts/match";
import type {ShortcutId} from "../shortcuts/registry";

type TerminalKeyEvent = Pick<
	KeyboardEvent,
	"key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "getModifierState"
>;

interface AppChord
{
	code: string;
	ctrlKey: boolean;
	metaKey: boolean;
}

/**
 * App shortcuts that must escape an interactive terminal: ⌃` toggles the
 * terminal pane, ⌃Q switches recents, ⌘K opens search and ⌘/ the shortcuts
 * dialog. Everything else, including ⌃K and ⌃C, belongs to the TUI.
 */
const APP_CHORDS: readonly AppChord[] = [
	{
		code: "Backquote",
		ctrlKey: true,
		metaKey: false,
	},
	{
		code: "KeyQ",
		ctrlKey: true,
		metaKey: false,
	},
	{
		code: "KeyK",
		ctrlKey: false,
		metaKey: true,
	},
	{
		code: "Slash",
		ctrlKey: false,
		metaKey: true,
	},
];

/** The herdr pane keys (split, close, rename, switch), matched with this platform's registry bindings. */
const TERMINAL_SHORTCUTS: readonly ShortcutId[] = [
	"split_terminal_right",
	"split_terminal_down",
	"close_terminal_pane",
	"rename_terminal_tab",
	"next_terminal_pane",
	"prev_terminal_pane",
];

/** The Terminal pane's tab keys (upstream `newTerminal`, `nextTerminal`, `prevTerminal`). */
const TERMINAL_TAB_SHORTCUTS: readonly ShortcutId[] = ["new_terminal", "next_terminal", "prev_terminal"];

export interface TerminalKeyOptions
{
	isMac?: boolean;
	isWindows?: boolean;
	/** The terminal's pane shows more than one tab, so ⌃⇧] / ⌃⇧[ cycle tabs instead of reaching the shell. */
	multipleTabs?: boolean;
}

/**
 * xterm-style custom key handler: `false` leaves the key to the app. Like upstream's xterm pass-through, New
 * terminal always escapes, and Next/Previous terminal only while there is another tab to go to.
 */
export function terminalHandlesKey(
	event: TerminalKeyEvent,
	{isMac = isMacPlatform(), isWindows = isWindowsPlatform(), multipleTabs = false}: TerminalKeyOptions = {},
): boolean
{
	const appShortcuts: readonly ShortcutId[] = multipleTabs
		? [...TERMINAL_SHORTCUTS, ...TERMINAL_TAB_SHORTCUTS]
		: [...TERMINAL_SHORTCUTS, "new_terminal"];
	if (appShortcuts.some((id) => bindingsFor(id, isMac, isWindows).some((b) => matchBinding(event, b))))
	{
		return false;
	}
	if (event.altKey || event.shiftKey) return true;
	return !APP_CHORDS.some(
		(chord) => chord.code === event.code && chord.ctrlKey === event.ctrlKey && chord.metaKey === event.metaKey,
	);
}
