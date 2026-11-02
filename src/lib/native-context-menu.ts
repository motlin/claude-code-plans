/*
 * When a right-click (or long press) belongs to the browser's own context menu
 * rather than a custom one. Ported from claude.ai/code's transcript menu host
 * (`Qx` in c01e7498d): `wx` (press on the selection), `Ex`/`jx`/`Mx`/`Px` (press
 * on selectable text), `Nx` (press near the selection) and `Rx` (selection
 * touches the row). Upstream also walks open shadow roots; local transcripts
 * render none, so that branch is left out.
 */
import type {MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent} from "react";

/** Upstream `Kx`: hit-test slop around text and selection boxes, in px. */
const SLOP = 2;

/** Either caret hit test may be missing: Safari before 18.4 has only `caretRangeFromPoint`, jsdom neither. */
interface CaretDocument
{
	caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
	caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

function caretAt(
	document: CaretDocument,
	x: number,
	y: number,
):
{
	node: Node;
	offset: number;
} | null
{
	const position = document.caretPositionFromPoint?.(x, y);
	if (position)
		return {
			node: position.offsetNode,
			offset: position.offset,
		};
	const range = document.caretRangeFromPoint?.(x, y);
	return range
		?
			{
				node: range.startContainer,
				offset: range.startOffset,
			}
		: null;
}

function pointInRange(range: Range, node: Node, offset: number): boolean
{
	try
	{
		return range.isPointInRange(node, offset);
	}
	catch
	{
		return false;
	}
}

function inRect(rect: DOMRect | undefined, x: number, y: number, slop: number): boolean
{
	return (
		rect !== undefined &&
		x >= rect.left - slop &&
		x <= rect.right + slop &&
		y >= rect.top - slop &&
		y <= rect.bottom + slop
	);
}

/** Upstream `wx`: the press at `x`,`y` lands inside a non-blank selection. */
function pressOnSelection(window: Window, x: number, y: number): boolean
{
	const selection = window.getSelection();
	if (selection === null || selection.isCollapsed) return false;
	const caret = caretAt(window.document, x, y);
	for (let index = 0; index < selection.rangeCount; index++)
	{
		const range = selection.getRangeAt(index);
		if (caret !== null)
		{
			if (pointInRange(range, caret.node, caret.offset)) return selection.toString().trim() !== "";
			continue;
		}
		for (const rect of range.getClientRects())
		{
			if (inRect(rect, x, y, 0)) return selection.toString().trim() !== "";
		}
	}
	return false;
}

/** Upstream `Mx`: one of `text`'s line boxes holds the point, with half the leading as vertical slop. */
function pointOnTextBox(window: Window, text: Node, parent: Element, x: number, y: number): boolean
{
	const range = window.document.createRange();
	range.selectNodeContents(text);
	let lineHeight: number | undefined;
	for (const rect of range.getClientRects())
	{
		if (x < rect.left - SLOP || x > rect.right + SLOP) continue;
		lineHeight ??= Number.parseFloat(window.getComputedStyle(parent).lineHeight);
		const slop =
			SLOP + (Number.isFinite(lineHeight) ? Math.max(0, (lineHeight - (rect.bottom - rect.top)) / 2) : 0);
		if (y >= rect.top - slop && y <= rect.bottom + slop) return true;
	}
	return false;
}

/** Upstream `Px`: the text is selectable (not inside a link or button in `root`, nor `user-select: none`). */
function selectable(window: Window, element: Element, root: Element): boolean
{
	const control = element.closest("a[href], button");
	if (control !== null && root.contains(control)) return false;
	for (let node: Element | null = element; node !== null; node = node.parentElement)
	{
		const style = window.getComputedStyle(node);
		const userSelect = style.userSelect || style.getPropertyValue("-webkit-user-select");
		if (userSelect === "none") return false;
		if (userSelect && userSelect !== "auto") return true;
	}
	return true;
}

/** Upstream `Ex`: the press at `x`,`y` lands on selectable text inside `root`. */
function pressOnText(window: Window, x: number, y: number, root: Element): boolean
{
	const node = caretAt(window.document, x, y)?.node;
	if (node?.nodeType !== Node.TEXT_NODE) return false;
	const parent = node.parentElement;
	return (
		parent !== null &&
		pointOnTextBox(window, node, parent, x, y) &&
		root.contains(parent) &&
		selectable(window, parent, root)
	);
}

/** Upstream `Nx`: the press at `x`,`y` lands within `SLOP` of a selection box. */
function pressNearSelection(window: Window, x: number, y: number): boolean
{
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed) return false;
	for (let index = 0; index < selection.rangeCount; index++)
	{
		for (const rect of selection.getRangeAt(index).getClientRects())
		{
			if (inRect(rect, x, y, SLOP)) return true;
		}
	}
	return false;
}

/** Upstream `Rx`: a non-blank selection reaches into `element`. */
function selectionTouches(element: Element): boolean
{
	const selection = element.ownerDocument.getSelection();
	if (!selection || selection.isCollapsed || selection.toString().trim() === "") return false;
	for (let index = 0; index < selection.rangeCount; index++)
	{
		if (selection.getRangeAt(index).intersectsNode(element)) return true;
	}
	return false;
}

/** Upstream `Lx`: how long a recorded right press stays paired with its contextmenu, in ms. */
const PRESS_PAIRING_MS = 10_000;

interface RecordedPress
{
	onSelection: boolean;
	at: number;
}

/** Upstream `Fx`: pointerdowns already recorded by an inner menu host. */
const recordedPointerDowns = new WeakSet<Event>();
/** Upstream `Ix`: each contextmenu's "the right press landed on the selection" answer. */
const pressOnSelectionByEvent = new WeakMap<Event, boolean>();

/**
 * Upstream `Qx`'s `se`/`ce`/`le`: records on the right press (before the
 * browser can move the selection) whether it landed on the selection, and
 * pairs that answer with the contextmenu that follows.
 */
export interface PressRecorder
{
	onPointerDown: (event: ReactPointerEvent) => void;
	onPointerUp: (event: ReactPointerEvent) => void;
	onContextMenuCapture: (event: ReactMouseEvent) => void;
}

export function createPressRecorder(): PressRecorder
{
	let press: RecordedPress | null = null;
	return {
		onPointerDown(event: ReactPointerEvent)
		{
			const window = event.currentTarget.ownerDocument.defaultView;
			const rightPress = event.button === 2 || event.ctrlKey || event.nativeEvent.pointerType !== "mouse";
			press =
				rightPress &&
				window !== null &&
				!recordedPointerDowns.has(event.nativeEvent) &&
				event.target instanceof Node &&
				event.currentTarget.contains(event.target)
					?
						{
							onSelection: pressOnSelection(window, event.clientX, event.clientY),
							at: event.timeStamp,
						}
					: null;
			recordedPointerDowns.add(event.nativeEvent);
		},
		onPointerUp(event: ReactPointerEvent)
		{
			if (event.button !== 2) press = null;
		},
		onContextMenuCapture(event: ReactMouseEvent)
		{
			const recorded = press;
			press = null;
			const elapsed = recorded === null ? -1 : event.timeStamp - recorded.at;
			if (recorded !== null && elapsed >= 0 && elapsed < PRESS_PAIRING_MS)
			{
				pressOnSelectionByEvent.set(event.nativeEvent, recorded.onSelection);
			}
		},
	};
}

function pointerTypeOf(event: ReactMouseEvent): string | undefined
{
	return (event.nativeEvent as Partial<PointerEvent>).pointerType;
}

/**
 * Upstream `eS`: the contextmenu is over the selection — by its recorded right
 * press, or, from the keyboard (no pointer type), when the selection touches the row.
 */
function contextMenuOnSelection(event: ReactMouseEvent): boolean
{
	const pointerType = pointerTypeOf(event);
	const recorded = pressOnSelectionByEvent.get(event.nativeEvent);
	if (recorded !== undefined && pointerType !== "") return recorded;
	return (pointerType === "" || pointerType === undefined) && selectionTouches(event.currentTarget);
}

/** Upstream `$x`: a touch lands on selectable text or on the selection, which the browser handles. */
export function touchOnTextOrSelection(element: Element, x: number, y: number): boolean
{
	const window = element.ownerDocument.defaultView;
	return window !== null && (pressOnText(window, x, y, element) || pressNearSelection(window, x, y));
}

/**
 * Upstream `he`'s native branch: a touch (or a pen press other than its
 * barrel button) on text or the selection, or a mouse right-click on the
 * selection of a row that cannot attach it as context.
 */
export function wantsNativeContextMenu(event: ReactMouseEvent, canAttachAsContext: boolean): boolean
{
	const pointerType = pointerTypeOf(event);
	if (pointerType === "touch" || (pointerType === "pen" && event.button !== 2))
	{
		return touchOnTextOrSelection(event.currentTarget, event.clientX, event.clientY);
	}
	return contextMenuOnSelection(event) && !canAttachAsContext;
}

/*
 * Popups that opt out of the browser's context menu. Upstream's cds `Menu.Popup` adds nothing on `contextmenu`;
 * each call site opts in through its `onContextMenu` (shared-1 `ik`/`I0`, and the plain `qw`/`xT`/`Yi`).
 */

/** Upstream `qw`/`xT`/`Yi`/`ki`: a right-click anywhere inside the popup never shows the browser menu. */
export function preventNativeContextMenu(event: {preventDefault: () => void}): void
{
	event.preventDefault();
}

/** Upstream `Zd`: targets whose right-click keeps the browser menu. */
export const NATIVE_MENU_TARGETS =
	'input, textarea, select, [contenteditable]:not([contenteditable="false"]), a[href], img, video, audio, [role="menu"]';

/**
 * Upstream `ik`: whether a `contextmenu` reaching `root` should suppress the browser menu. Not when it is already
 * prevented, when `root` is off the native path (it only reached the handler through a React portal), when it
 * started on (or inside) a native-menu target, or when a non-blank selection touches `root`.
 */
export function suppressesNativeMenu(
	event:
	{
		defaultPrevented: boolean;
		nativeEvent: Event;
	},
	root: Element,
): boolean
{
	if (event.defaultPrevented) return false;
	const path = event.nativeEvent.composedPath();
	const rootIndex = path.indexOf(root);
	if (
		rootIndex === -1 ||
		path.slice(0, rootIndex + 1).some((target) => target instanceof Element && target.matches(NATIVE_MENU_TARGETS))
	)
	{
		return false;
	}
	const selection = root.ownerDocument.getSelection();
	return !(
		selection !== null &&
		selection.rangeCount > 0 &&
		selection.toString().trim() !== "" &&
		selection.getRangeAt(0).intersectsNode(root)
	);
}

/** Upstream `I0`: suppress the browser menu in a popover unless the press is on a native target or selected text. */
export function preventNativeMenuOutsideText(event: ReactMouseEvent): void
{
	if (suppressesNativeMenu(event, event.currentTarget)) event.preventDefault();
}
