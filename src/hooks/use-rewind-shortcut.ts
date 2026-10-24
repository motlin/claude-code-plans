import {useCallback, useEffect, useRef, useState} from "react";

import {getComposerText} from "../lib/context-attach";
import {canOpenRewindPicker, REWIND_ESC_WINDOW_MS} from "../lib/rewind-picker";

/** Upstream's `Wl`: Escapes inside the terminal belong to it. */
const TERMINAL_SELECTOR = 'canvas, [role="application"]';

export interface RewindPickerOptions {
	sessionId: string;
	/** A live pane that accepts writes, on a session that isn't archived. */
	available: boolean;
	/** Claude is working, a prompt is in flight, or a question, permission or plan card is up. */
	busy: boolean;
	now?: () => number;
}

export interface RewindPickerState {
	open: boolean;
	/** The picker has opened at least once on this session, so its lazy chunk is wanted. */
	used: boolean;
	/**
	 * Open the picker if upstream's `E_` gate allows it. `/rewind` passes
	 * `fromComposer`, since the composer still holds the command as it sends.
	 */
	requestOpen: (options?: {fromComposer?: boolean}) => void;
	close: () => void;
}

function isPlainEscape(event: KeyboardEvent): boolean {
	return (
		event.key === "Escape" &&
		!event.repeat &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey &&
		!event.isComposing &&
		// oxlint-disable-next-line typescript/no-deprecated -- Safari reports IME keydowns only as keyCode 229, as upstream checks
		event.keyCode !== 229
	);
}

/**
 * The Rewind picker's open state with upstream's two openers: `Esc` `Esc`
 * (`Tp`: a window keydown counted before any `defaultPrevented` check, so the
 * first Escape can still close a menu or stop Claude) and `requestOpen` for
 * `/rewind`.
 */
export function useRewindPicker({sessionId, available, busy, now = Date.now}: RewindPickerOptions): RewindPickerState {
	const [open, setOpen] = useState(false);
	const [used, setUsed] = useState(false);
	const closedAtRef = useRef<number | null>(null);
	const lastEscapeRef = useRef<number | null>(null);
	const gateRef = useRef({sessionId, available, busy, now});
	gateRef.current = {sessionId, available, busy, now};

	useEffect(() => {
		setOpen(false);
		setUsed(false);
		closedAtRef.current = null;
		lastEscapeRef.current = null;
	}, [sessionId]);

	const requestOpen = useCallback(({fromComposer = false}: {fromComposer?: boolean} = {}) => {
		const gate = gateRef.current;
		const draft = fromComposer ? "" : (getComposerText(gate.sessionId) ?? "");
		if (canOpenRewindPicker({...gate, draft, now: gate.now(), closedAt: closedAtRef.current})) {
			setOpen(true);
			setUsed(true);
		}
	}, []);

	const close = useCallback(() => {
		closedAtRef.current = gateRef.current.now();
		setOpen(false);
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const inTerminal = event.target instanceof Element && event.target.closest(TERMINAL_SELECTOR) !== null;
			if (!isPlainEscape(event) || inTerminal) {
				lastEscapeRef.current = null;
				return;
			}
			const at = gateRef.current.now();
			const last = lastEscapeRef.current;
			if (last === null || at - last > REWIND_ESC_WINDOW_MS) {
				lastEscapeRef.current = at;
				return;
			}
			lastEscapeRef.current = null;
			event.preventDefault();
			requestOpen();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [requestOpen]);

	return {open, used, requestOpen, close};
}
