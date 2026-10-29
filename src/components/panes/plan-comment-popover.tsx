import {
	type ClipboardEvent,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {createPortal} from "react-dom";

import {CommentEditor} from "../comment-editor";

const POPOVER_WIDTH = 320;
const GAP = 8;
const MARGIN = 8;

const POPOVER_CLASS =
	"fixed left-0 top-0 isolate z-[90] w-[320px] break-words rounded-r7 bg-surface-3 text-body text-primary outline-none shadow-[0_0_0_1px_rgb(11_11_11/0.1),0_8px_24px_rgb(0_0_0/0.12),0_2px_6px_rgb(0_0_0/0.08)] dark:shadow-[0_0_0_1px_var(--color-border),0_8px_24px_rgb(0_0_0/0.12),0_2px_6px_rgb(0_0_0/0.08)] [will-change:transform]";

const SELECTION_HIGHLIGHT = "plan-selection";

function highlightRegistry(): HighlightRegistry | undefined {
	return typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined;
}

/** Keeps the commented range painted after the window selection is cleared, as upstream's selection highlight does. */
function paintSelection(range: Range): () => void {
	const registry = highlightRegistry();
	if (registry === undefined || typeof Highlight === "undefined") return () => {};
	registry.set(SELECTION_HIGHLIGHT, new Highlight(range));
	return () => {
		registry.delete(SELECTION_HIGHLIGHT);
	};
}

/**
 * Upstream's placement: centred 8px under the selection's last line, flipped above its first line
 * when there is no room below, clamped to the pane horizontally and to the viewport vertically.
 */
function placement(range: Range, bounds: DOMRect, height: number): {x: number; y: number} | null {
	if (typeof range.getClientRects !== "function") return null;
	const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
	const first = rects[0];
	const last = rects.at(-1);
	if (first === undefined || last === undefined) return null;
	const half = POPOVER_WIDTH / 2;
	const centre = (last.left + last.right) / 2;
	const minX = Math.max(bounds.left, 0) + half + MARGIN;
	const maxX = Math.min(bounds.right, window.innerWidth) - half - MARGIN;
	const x = minX > maxX ? (minX + maxX) / 2 : Math.min(Math.max(centre, minX), maxX);
	const below = last.bottom + GAP;
	const y = below + height + MARGIN <= window.innerHeight ? below : first.top - GAP - height;
	return {x, y: Math.min(Math.max(y, MARGIN), window.innerHeight - height - MARGIN)};
}

/** The pane's commentable selection: the live range, the text it covers and its flattened offsets. */
export interface PlanSelection {
	range: Range;
	text: string;
	start: number;
	end: number;
}

/**
 * Upstream's "Comment on selection" popover: a fixed 320px card portalled to the body, holding the
 * shared comment editor in its floating variant. It clears the window selection on open but keeps
 * the range painted, follows scroll and resize, closes on an outside press only while the draft is
 * blank, and keeps Tab inside itself.
 */
export function PlanCommentPopover({
	selection,
	boundary,
	value,
	onChange,
	onSave,
	onClose,
}: {
	selection: PlanSelection;
	/** The pane root, whose rect clamps the popover horizontally. */
	boundary: HTMLElement;
	value: string;
	onChange: (value: string) => void;
	onSave: (comment: string) => void;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	// Unplaced, it stays focusable but invisible (not `visibility: hidden`, which would drop the autofocus).
	const [position, setPosition] = useState<{x: number; y: number} | null>(null);

	useLayoutEffect(() => {
		document.getSelection()?.removeAllRanges();
		return paintSelection(selection.range);
	}, [selection.range]);

	const reposition = useCallback(() => {
		const height = dialogRef.current?.offsetHeight ?? 0;
		setPosition(placement(selection.range, boundary.getBoundingClientRect(), height));
	}, [selection.range, boundary]);

	useLayoutEffect(() => {
		reposition();
		let frame = 0;
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(reposition);
		};
		window.addEventListener("scroll", schedule, true);
		window.addEventListener("resize", schedule);
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
		observer?.observe(boundary);
		if (dialogRef.current !== null) observer?.observe(dialogRef.current);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", schedule, true);
			window.removeEventListener("resize", schedule);
			observer?.disconnect();
		};
	}, [reposition, boundary]);

	const blank = value.trim() === "";
	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && dialogRef.current?.contains(event.target) === true) return;
			if (blank) onClose();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [blank, onClose]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Tab") return;
		const focusable = Array.from(
			event.currentTarget.querySelectorAll<HTMLElement>("textarea, button:not([disabled])"),
		);
		if (focusable.length === 0) return;
		event.preventDefault();
		const index = focusable.findIndex((element) => element === document.activeElement);
		const step = event.shiftKey ? -1 : 1;
		focusable[(index + step + focusable.length) % focusable.length]?.focus();
	};

	/** Copy or cut with a bare caret in the draft copies the selected plan text, as upstream does. */
	const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
		const target = event.target;
		if (!(target instanceof HTMLTextAreaElement) || target.selectionStart !== target.selectionEnd) return;
		event.preventDefault();
		event.clipboardData.setData("text/plain", selection.text);
	};

	return createPortal(
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a dialog traps Tab and copies the selection for the editor inside it
		<div
			ref={dialogRef}
			role="dialog"
			tabIndex={-1}
			aria-label="Comment on selection"
			className={POPOVER_CLASS}
			style={
				position === null
					? {opacity: 0, pointerEvents: "none"}
					: {transform: `translate(${position.x}px, ${position.y}px) translateX(-50%)`}
			}
			onKeyDown={onKeyDown}
			onCopy={onCopy}
			onCut={onCopy}
		>
			<CommentEditor
				variant="floating"
				inputLabel="Plan comment"
				isEditing
				autoFocus
				value={value}
				onChange={onChange}
				onSave={(text) => {
					onSave(text);
				}}
				onCancel={onClose}
			/>
		</div>,
		document.body,
	);
}
