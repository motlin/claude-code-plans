import {useCallback, useEffect, useRef} from "react";

import {sendHerdrInterrupt} from "../lib/api/herdr";
import {useShortcut} from "./use-shortcut";

/** A second stop within this window escalates from Esc to ctrl+c. */
export const STOP_FORCE_WINDOW_MS = 2000;

/** Stop response needs a working session with a live herdr pane that accepts writes. */
export function canStopResponse({
	hasLivePane,
	writesEnabled,
	working,
}: {
	hasLivePane: boolean;
	writesEnabled: boolean;
	working: boolean;
}): boolean {
	return hasLivePane && writesEnabled && working;
}

export interface StopResponseOptions {
	sessionId: string;
	enabled: boolean;
	/** Called with the press time as each interrupt is sent. */
	onInterrupt: (at: number) => void;
	onError: (error: unknown) => void;
	interrupt?: (sessionId: string, force: boolean) => Promise<void>;
	now?: () => number;
}

/**
 * Stop Claude's response in the live herdr pane from the composer Stop button
 * or Esc (which yields to open menus and dialogs). A second press within
 * {@link STOP_FORCE_WINDOW_MS} sends ctrl+c instead of Esc.
 */
export function useStopResponse({
	sessionId,
	enabled,
	onInterrupt,
	onError,
	interrupt = (id, force) => sendHerdrInterrupt(id, force),
	now = Date.now,
}: StopResponseOptions): () => void {
	const lastPressRef = useRef<number | null>(null);

	useEffect(() => {
		lastPressRef.current = null;
	}, [sessionId]);

	const stop = useCallback(() => {
		const at = now();
		const last = lastPressRef.current;
		const force = last !== null && at - last <= STOP_FORCE_WINDOW_MS;
		lastPressRef.current = force ? null : at;
		onInterrupt(at);
		interrupt(sessionId, force).catch(onError);
	}, [interrupt, now, onError, onInterrupt, sessionId]);

	useShortcut(
		"stop_response",
		() => {
			stop();
		},
		{disabled: !enabled},
	);

	return stop;
}
