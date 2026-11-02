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
}): boolean
{
	return hasLivePane && writesEnabled && working;
}

/* A module-level default keeps `stop` stable across renders, so the composer can key its Stop latch on it. */
const defaultInterrupt = async (sessionId: string, force: boolean): Promise<void> =>
	sendHerdrInterrupt(sessionId, force);

export interface StopResponseOptions
{
	sessionId: string;
	enabled: boolean;
	/** Called with the press time as each interrupt is sent. */
	onInterrupt: (at: number) => void;
	onError: (error: unknown) => void;
	interrupt?: (sessionId: string, force: boolean) => Promise<void>;
	now?: () => number;
	/** Upstream's `onEscapeRecall`: Esc runs it first and stops only when it reports nothing recalled. */
	onEscapeRecall?: () => boolean;
}

/**
 * Stop Claude's response in the live herdr pane from the composer Stop button
 * or Esc (which yields to open menus and dialogs). A second press within
 * {@link STOP_FORCE_WINDOW_MS} sends ctrl+c instead of Esc. Esc first offers `onEscapeRecall` the key;
 * the Stop button always stops.
 */
export function useStopResponse({
	sessionId,
	enabled,
	onInterrupt,
	onError,
	interrupt = defaultInterrupt,
	now = Date.now,
	onEscapeRecall,
}: StopResponseOptions): () => void
{
	const lastPressRef = useRef<number | null>(null);

	useEffect(() =>
	{
		lastPressRef.current = null;
	}, [sessionId]);

	const stop = useCallback(() =>
	{
		const at = now();
		const last = lastPressRef.current;
		const force = last !== null && at - last <= STOP_FORCE_WINDOW_MS;
		lastPressRef.current = force ? null : at;
		onInterrupt(at);
		interrupt(sessionId, force).catch(onError);
	}, [interrupt, now, onError, onInterrupt, sessionId]);

	useShortcut(
		"stop_response",
		() =>
		{
			if (onEscapeRecall?.() === true) return;
			stop();
		},
		{
			disabled: !enabled,
		},
	);

	return stop;
}
