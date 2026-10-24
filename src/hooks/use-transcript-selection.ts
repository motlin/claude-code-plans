import {type RefObject, useEffect, useState} from "react";

import {MIN_EXCERPT_LENGTH} from "./use-transcript-selection-attach";

/** Upstream's `bx`: how long a selection made without a drag settles before the bar shows. */
const SELECTION_DEBOUNCE_MS = 250;

export interface TranscriptSelection {
	/** A snapshot of the selection's first range when the bar showed. */
	range: Range;
	/** The trimmed selected text. */
	text: string;
}

/** The selection as upstream's `xV` counts it: two or more trimmed characters touching `container`. */
function readSelection(container: Element): TranscriptSelection | null {
	const selection = container.ownerDocument.getSelection();
	if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const text = selection.toString().trim();
	if (text.length < MIN_EXCERPT_LENGTH) return null;
	const range = selection.getRangeAt(0);
	const touches = container.contains(range.startContainer) || container.contains(range.endContainer);
	if (!touches || !range.intersectsNode(container)) return null;
	return {range: range.cloneRange(), text};
}

/** Touch, or a pen's non-right press, selects with the native callout instead of the bar (upstream `YS`). */
function isTouchPointer(event: PointerEvent): boolean {
	return event.pointerType === "touch" || (event.pointerType === "pen" && event.button !== 2);
}

/**
 * The transcript selection the selection bar should show for, like upstream's
 * `xV`: it settles 250ms after a keyboard or programmatic change, waits for
 * mouseup during a drag, hides at once when the selection collapses, and stays
 * null after a touch press.
 */
export function useTranscriptSelection(containerRef: RefObject<Element | null>): TranscriptSelection | null {
	const [shown, setShown] = useState<TranscriptSelection | null>(null);

	useEffect(() => {
		const doc = containerRef.current?.ownerDocument ?? document;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let dragging = false;
		let touch = false;

		const cancel = () => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		};
		const evaluate = () => {
			cancel();
			const container = containerRef.current;
			setShown(container === null || touch ? null : readSelection(container));
		};
		const debounce = () => {
			cancel();
			timer = setTimeout(evaluate, SELECTION_DEBOUNCE_MS);
		};
		const onSelectionChange = () => {
			const selection = doc.getSelection();
			if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
				cancel();
				setShown(null);
				return;
			}
			if (!dragging) debounce();
		};
		const onPointerDown = (event: PointerEvent) => {
			touch = isTouchPointer(event);
			if (touch) {
				cancel();
				setShown(null);
			}
		};
		const onMouseDown = (event: MouseEvent) => {
			if (event.button === 0) dragging = true;
		};
		const onMouseUp = (event: MouseEvent) => {
			if (!dragging) return;
			dragging = false;
			if (event.detail === 2) debounce();
			else evaluate();
		};

		doc.addEventListener("selectionchange", onSelectionChange);
		doc.addEventListener("pointerdown", onPointerDown, true);
		doc.addEventListener("mousedown", onMouseDown, true);
		doc.addEventListener("mouseup", onMouseUp, true);
		return () => {
			cancel();
			doc.removeEventListener("selectionchange", onSelectionChange);
			doc.removeEventListener("pointerdown", onPointerDown, true);
			doc.removeEventListener("mousedown", onMouseDown, true);
			doc.removeEventListener("mouseup", onMouseUp, true);
		};
	}, [containerRef]);

	return shown;
}
