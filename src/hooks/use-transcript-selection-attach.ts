import type {RefObject} from "react";

import {attachContext} from "../lib/context-attach";
import {useShortcut} from "./use-shortcut";

/** Upstream's `a7`: the shortest trimmed selection that attaches as an Excerpt. */
export const MIN_EXCERPT_LENGTH = 2;

/** An open dialog; the always-mounted phone sheet is `inert` while closed. */
const OPEN_DIALOG_SELECTOR = '[role="dialog"]:not([inert]), [role="alertdialog"]:not([inert])';

/**
 * The trimmed document selection when every range lies inside `container` and
 * it has at least two characters, else null (upstream `uC`'s guard).
 */
function transcriptSelection(container: Element): string | null {
	const selection = container.ownerDocument.getSelection();
	if (selection === null || selection.rangeCount === 0) return null;
	for (let index = 0; index < selection.rangeCount; index++) {
		const range = selection.getRangeAt(index);
		if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
	}
	const text = selection.toString().trim();
	return text.length >= MIN_EXCERPT_LENGTH ? text : null;
}

/**
 * ⇧⌘L (`attach_selection`) attaches a transcript selection to the session's
 * composer as an Excerpt, like upstream's `uC`. Declines otherwise so the Files
 * viewer and Terminal handlers still claim the key.
 */
export function useTranscriptSelectionAttach(sessionId: string, containerRef: RefObject<Element | null>): void {
	useShortcut(
		"attach_selection",
		() => {
			const container = containerRef.current;
			if (container === null) return false;
			if (container.ownerDocument.querySelector(OPEN_DIALOG_SELECTOR) !== null) return false;
			const text = transcriptSelection(container);
			if (text === null) return false;
			if (!attachContext(sessionId, {kind: "excerpt", text})) return false;
			container.ownerDocument.getSelection()?.removeAllRanges();
			return true;
		},
		{allowInEditable: false},
	);
}
