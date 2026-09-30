import type {Terminal} from "ghostty-web";
import {useCallback, useEffect, useRef, useState} from "react";
import {dispatchShortcutEvent} from "../hooks/use-shortcut";
import {writeClipboardText} from "../lib/clipboard";
import {terminalHandlesKey} from "../lib/herdr/terminal-keys";
import {
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
export function useTerminalSelectionActions(sessionId: string): {
	actions: SelectionActions;
	announcement: string;
} {
	const [announcement, setAnnouncement] = useState("");
	const sessionRef = useRef(sessionId);
	sessionRef.current = sessionId;
	const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (clearTimer.current) clearTimeout(clearTimer.current);
		},
		[],
	);

	const attach = useCallback((text: string) => {
		if (!attachTerminalSelection(sessionRef.current, text)) return;
		setAnnouncement(TERMINAL_ATTACHED_MESSAGE);
		if (clearTimer.current) clearTimeout(clearTimer.current);
		clearTimer.current = setTimeout(() => setAnnouncement(""), ANNOUNCEMENT_MS);
	}, []);

	const actions = useRef<SelectionActions>({
		copy: (text) => void writeClipboardText(text),
		attach,
	}).current;

	return {actions, announcement};
}

export function TerminalSelectionStatus({announcement}: {announcement: string}) {
	return (
		<p role="status" className="sr-only">
			{announcement}
		</p>
	);
}

/**
 * Key handling and links for an opened terminal. Selection chords come first;
 * Ghostty skips (and preventDefaults) keys the handler claims, which would
 * hide app chords from the document shortcut listener, so those are
 * dispatched to the app here. Links go through the "Open link?" confirm.
 */
export function installTerminalInput(terminal: Terminal, actions: SelectionActions): void {
	terminal.attachCustomKeyEventHandler((event) => {
		if (handleTerminalSelectionKey(event, terminal, actions)) return true;
		if (terminalHandlesKey(event)) return false;
		dispatchShortcutEvent(event);
		return true;
	});
	guardTerminalLinks(terminal, (href) => {
		openTerminalLink(href, browserLinkOpener);
	});
}
