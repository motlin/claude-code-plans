import {type RefObject, useCallback, useEffect, useState} from "react";

import {MIN_EXCERPT_LENGTH} from "./use-transcript-selection-attach";

/** Upstream's `bx`: how long a selection made without a drag settles before the bar shows. */
const SELECTION_DEBOUNCE_MS = 250;

export interface TranscriptSelection
{
	/** A snapshot of the selection's first range when the bar showed. */
	range: Range;
	/** The trimmed selected text. */
	text: string;
}

/** The selection as upstream's `xV` counts it: two or more trimmed characters touching `container`. */
function readSelection(container: Element):
{
	range: Range;
	text: string;
} | null
{
	const selection = container.ownerDocument.getSelection();
	if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const text = selection.toString().trim();
	if (text.length < MIN_EXCERPT_LENGTH) return null;
	const range = selection.getRangeAt(0);
	const touches = container.contains(range.startContainer) || container.contains(range.endContainer);
	if (!touches || !range.intersectsNode(container)) return null;
	return {
		range,
		text,
	};
}

/** Upstream `tT`: whether two ranges share both boundaries. */
function sameBoundaries(a: Range, b: Range): boolean
{
	return (
		a.startContainer === b.startContainer &&
		a.startOffset === b.startOffset &&
		a.endContainer === b.endContainer &&
		a.endOffset === b.endOffset
	);
}

/** Touch, or a pen's non-right press, selects with the native callout instead of the bar (upstream `Gw`). */
function isTouchPointer(event: PointerEvent): boolean
{
	return event.pointerType === "touch" || (event.pointerType === "pen" && event.button !== 2);
}

export interface TranscriptSelectionState
{
	selection: TranscriptSelection | null;
	/** Upstream's `hideTooltip`: hide the bar until the selection is next read. */
	hide: () => void;
}

/**
 * The transcript selection the selection bar should show for, like upstream's
 * `Dv`: it settles 250ms after a keyboard or programmatic change, hides at once
 * when the selection changes during a mouse drag and re-reads it on mouseup,
 * hides at once when the selection collapses, and stays null after a touch
 * press inside the transcript (upstream `Gw`).
 */
export function useTranscriptSelection(containerRef: RefObject<Element | null>): TranscriptSelectionState
{
	const [shown, setShown] = useState<TranscriptSelection | null>(null);
	const hide = useCallback(() =>
	{
		setShown(null);
	}, []);

	useEffect(() =>
	{
		const container = containerRef.current;
		const doc = container?.ownerDocument ?? document;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let dragging = false;
		/** Upstream `f`: the selection changed during the current drag. */
		let changedDuringDrag = false;
		/** Upstream `p`: the settle timer fired during the current drag. */
		let firedDuringDrag = false;
		let touch = false;

		const cancel = () =>
		{
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			firedDuringDrag = false;
		};
		const hideNow = () =>
		{
			cancel();
			setShown(null);
		};
		const evaluate = () =>
		{
			cancel();
			const current = containerRef.current;
			const next = current === null || touch ? null : readSelection(current);
			if (next === null)
			{
				setShown(null);
				return;
			}
			setShown((previous) =>
				previous !== null && previous.text === next.text && sameBoundaries(previous.range, next.range)
					? previous
					:
						{
							range: next.range.cloneRange(),
							text: next.text,
						},
			);
		};
		const debounce = () =>
		{
			cancel();
			timer = setTimeout(() =>
			{
				timer = undefined;
				if (dragging)
				{
					firedDuringDrag = true;
					return;
				}
				evaluate();
			}, SELECTION_DEBOUNCE_MS);
		};
		const onSelectionChange = () =>
		{
			const selection = doc.getSelection();
			if (selection === null || selection.rangeCount === 0 || selection.isCollapsed)
			{
				hideNow();
				return;
			}
			if (dragging)
			{
				changedDuringDrag = true;
				hideNow();
				return;
			}
			debounce();
		};
		const onPointerDown = (event: Event) =>
		{
			if (!(event instanceof PointerEvent)) return;
			touch = isTouchPointer(event);
			if (touch) hideNow();
		};
		const onMouseDown = (event: MouseEvent) =>
		{
			if (event.defaultPrevented || dragging) return;
			dragging = true;
			changedDuringDrag = false;
		};
		const onMouseUp = (event: MouseEvent) =>
		{
			if (!dragging || event.buttons !== 0) return;
			dragging = false;
			const fired = firedDuringDrag;
			firedDuringDrag = false;
			if (!changedDuringDrag)
			{
				if (doc.getSelection()?.isCollapsed === false)
				{
					if (fired) debounce();
				}
				else hideNow();
				return;
			}
			if (event.detail === 2) debounce();
			else evaluate();
		};

		doc.addEventListener("selectionchange", onSelectionChange);
		container?.addEventListener(
			"pointerdown",
			onPointerDown,
			{
				capture: true,
				passive: true,
			},
		);
		doc.addEventListener("mousedown", onMouseDown);
		doc.addEventListener("mouseup", onMouseUp);
		return () =>
		{
			cancel();
			doc.removeEventListener("selectionchange", onSelectionChange);
			container?.removeEventListener(
				"pointerdown",
				onPointerDown,
				{
					capture: true,
				},
			);
			doc.removeEventListener("mousedown", onMouseDown);
			doc.removeEventListener("mouseup", onMouseUp);
		};
	}, [containerRef]);

	return {
		selection: shown,
		hide,
	};
}
