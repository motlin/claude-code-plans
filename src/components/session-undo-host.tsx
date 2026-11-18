import {useEffect, useSyncExternalStore} from "react";

import {isEditableTarget, isInKeystrokeSink, isInModalLayer, isMacPlatform} from "../lib/shortcuts/match";
import
{
	dismissSessionUndo,
	SESSION_UNDO_WINDOW_MS,
	sessionUndoNotice,
	sessionUndoTitle,
	subscribeSessionUndo,
	undoSessions,
} from "../lib/session-undo";
import {useToast} from "./toast-context";

const UNDO_TOAST_KEY = "session-undo";

function runUndo(): void
{
	void undoSessions();
}

/** Upstream `Jt`/`Wt`: ⌘Z on a Mac (Ctrl+Z elsewhere), no Shift or Alt, not a repeat, and not while typing. */
function isUndoChord(event: KeyboardEvent): boolean
{
	if (event.repeat || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z") return false;
	const mac = isMacPlatform();
	if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false;
	const focused = document.activeElement;
	return !isEditableTarget(event.target) && !isInKeystrokeSink(event.target) && !isInModalLayer(focused);
}

/**
 * Upstream `$t`: shows the session-undo stack as one toast ("Marked 2 sessions as completed" · Undo ⌘Z), restarted
 * by every offer, dismissing the stack when it closes, and owning ⌘Z while the stack holds anything.
 */
export function SessionUndoHost(): null
{
	const toast = useToast();
	const notice = useSyncExternalStore(subscribeSessionUndo, sessionUndoNotice, () => null);

	useEffect(() =>
	{
		if (notice === null) return undefined;
		const controller = new AbortController();
		toast(
			{
				kind: "success",
				message: sessionUndoTitle(notice),
				uniqueKey: UNDO_TOAST_KEY,
				durationMs: SESSION_UNDO_WINDOW_MS,
				signal: controller.signal,
				onClose: dismissSessionUndo,
				action:
				{
					label: "Undo",
					shortcut: "cmd+z",
					onAction: runUndo,
				},
			},
		);
		return () =>
		{
			controller.abort();
		};
	}, [notice, toast]);

	useEffect(() =>
	{
		if (notice === null) return undefined;
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (event.defaultPrevented || !isUndoChord(event)) return;
			event.preventDefault();
			runUndo();
		};
		window.addEventListener("keydown", onKeyDown);
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [notice]);

	return null;
}
