import type {Terminal} from "ghostty-web";
import {useCallback, useEffect, useRef, useState} from "react";
import {dispatchShortcutEvent} from "../hooks/use-shortcut";
import {writeClipboardText} from "../lib/clipboard";
import {terminalHandlesKey} from "../lib/herdr/terminal-keys";
import {isMacPlatform} from "../lib/shortcuts/match";
import type {CommandScrollDirection} from "../lib/terminal-prompt-marks";
import
{
	attachTerminalSelection,
	browserLinkOpener,
	guardTerminalLinks,
	handleTerminalSelectionKey,
	openTerminalLink,
	type SelectionActions,
	TERMINAL_ATTACHED_MESSAGE,
} from "../lib/terminal-selection";

const ANNOUNCEMENT_MS = 3000;

/**
 * Copy and ⇧⌘L-attach for one terminal view. `actions` stays stable so the
 * terminal's key handler can hold it; `announcement` feeds the sr-only status.
 */
export function useTerminalSelectionActions(sessionId: string | null):
{
	actions: SelectionActions;
	announcement: string;
}
{
	const [announcement, setAnnouncement] = useState("");
	const sessionRef = useRef(sessionId);
	sessionRef.current = sessionId;
	const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () =>
		{
			if (clearTimer.current) clearTimeout(clearTimer.current);
		},
		[],
	);

	const attach = useCallback((text: string) =>
	{
		if (sessionRef.current === null || !attachTerminalSelection(sessionRef.current, text)) return;
		setAnnouncement(TERMINAL_ATTACHED_MESSAGE);
		if (clearTimer.current) clearTimeout(clearTimer.current);
		clearTimer.current = setTimeout(() =>
		{
			setAnnouncement("");
		}, ANNOUNCEMENT_MS);
	}, []);

	const actions = useRef<SelectionActions>(
		{
			copy: (text) => void writeClipboardText(text),
			attach,
		},
	).current;

	return {
		actions,
		announcement,
	};
}

/**
 * Upstream's ⌘↑ / ⌘↓ (Ctrl off the Mac) in a terminal: jump to the previous or next command the shell marked.
 * Matched by `code` with key repeat allowed, and only claimed when `scrollToCommand` had marks to act on.
 */
function handleCommandScrollKey(
	event: KeyboardEvent,
	terminal: Terminal,
	scrollToCommand: (direction: CommandScrollDirection) => boolean,
): boolean
{
	if (terminal.buffer.active.type !== "normal") return false;
	if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return false;
	const modifier = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	if (!modifier || event.shiftKey || event.altKey) return false;
	return scrollToCommand(event.code === "ArrowUp" ? "previous" : "next");
}

/**
 * Key handling and links for an opened terminal. Selection chords come first, then the command-scroll keys
 * when the terminal tracks its shell's prompt marks. Ghostty skips (and preventDefaults) keys the handler claims, which would
 * hide app chords from the document shortcut listener, so those are
 * dispatched to the app here. Links go through the "Open link?" confirm.
 */
export function installTerminalInput(
	terminal: Terminal,
	actions: SelectionActions,
	hasMultipleTabs: () => boolean = () => false,
	scrollToCommand?: (direction: CommandScrollDirection) => boolean,
): void
{
	terminal.attachCustomKeyEventHandler((event) =>
	{
		if (handleTerminalSelectionKey(event, terminal, actions)) return true;
		if (scrollToCommand && handleCommandScrollKey(event, terminal, scrollToCommand)) return true;
		if (
			terminalHandlesKey(
				event,
				{
					multipleTabs: hasMultipleTabs(),
				},
			)
		)
			return false;
		dispatchShortcutEvent(event);
		return true;
	});
	guardTerminalLinks(terminal, (href) =>
	{
		openTerminalLink(href, browserLinkOpener);
	});
}
