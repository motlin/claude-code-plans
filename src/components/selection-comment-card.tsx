import
{
	type ClipboardEvent,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {createPortal} from "react-dom";

import {CommentEditor} from "./comment-editor";
import {FORCED_COLORS_BORDER_CLASS} from "./ui/popover-surface";

const CARD_WIDTH = 320;
const GAP = 8;
const MARGIN = 8;

const CARD_CLASS = `fixed left-0 top-0 isolate z-[90] w-[320px] break-words draggable-none rounded-r7 bg-surface-3 text-body text-primary outline-none shadow-[0_0_0_1px_rgb(11_11_11/0.1),0_8px_24px_rgb(0_0_0/0.12),0_2px_6px_rgb(0_0_0/0.08)] dark:shadow-[0_0_0_1px_var(--color-border),0_8px_24px_rgb(0_0_0/0.12),0_2px_6px_rgb(0_0_0/0.08)] ${FORCED_COLORS_BORDER_CLASS} [will-change:transform]`;

/** Upstream's reply card quote label (`showQuote`): the selected text, clamped to two lines. */
const QUOTE_CLASS =
	"line-clamp-2 border-s-2 border-strong ps-sm font-normal text-muted-as-secondary [overflow-wrap:anywhere]";

type Side = "above" | "below";

interface Position
{
	x: number;
	y: number;
}

function highlightRegistry(): HighlightRegistry | undefined
{
	return typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined;
}

/** Keeps the commented range painted after the window selection is cleared, as upstream's selection highlight does. */
function paintSelection(name: string, range: Range): () => void
{
	const registry = highlightRegistry();
	if (registry === undefined || typeof Highlight === "undefined")
		return () =>
		{
		};
	registry.set(name, new Highlight(range));
	return () =>
	{
		registry.delete(name);
	};
}

function lineRects(range: Range): DOMRect[] | null
{
	if (typeof range.getClientRects !== "function") return null;
	const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
	return rects.length === 0 ? null : rects;
}

function clampX(centre: number, bounds: DOMRect): number
{
	const half = CARD_WIDTH / 2;
	const minX = Math.max(bounds.left, 0) + half + MARGIN;
	const maxX = Math.min(bounds.right, window.innerWidth) - half - MARGIN;
	return minX > maxX ? (minX + maxX) / 2 : Math.min(Math.max(centre, minX), maxX);
}

function clampY(y: number, height: number): number
{
	return Math.min(Math.max(y, MARGIN), window.innerHeight - height - MARGIN);
}

/**
 * The plan popover's placement: centred 8px under the selection's last line, flipped above its first line
 * when there is no room below, clamped to the pane horizontally and to the viewport vertically.
 */
function placeBelow(range: Range, bounds: DOMRect, height: number): Position | null
{
	const rects = lineRects(range);
	const first = rects?.[0];
	const last = rects?.at(-1);
	if (first === undefined || last === undefined) return null;
	const below = last.bottom + GAP;
	const y = below + height + MARGIN <= window.innerHeight ? below : first.top - GAP - height;
	return {
		x: clampX((last.left + last.right) / 2, bounds),
		y: clampY(y, height),
	};
}

/**
 * Upstream `Rg` with `side:"above"` (the reply card): above the first line when it clears the visible top
 * by 8px, or when there is no room below either; else under the last line. The side is chosen once and held.
 */
function placeAbove(
	range: Range,
	bounds: DOMRect,
	height: number,
	held: Side | null,
):
{
	position: Position;
	side: Side;
} | null
{
	const rects = lineRects(range);
	const first = rects?.[0];
	const last = rects?.at(-1);
	if (first === undefined || last === undefined) return null;
	let side = held;
	if (side === null)
	{
		const visibleTop = Math.max(bounds.top, 0) + MARGIN;
		const visibleBottom = Math.min(bounds.bottom, window.innerHeight) - MARGIN;
		const aboveFits = first.top - GAP - height >= visibleTop;
		const belowFits = last.bottom + GAP + height <= visibleBottom;
		side = aboveFits || !belowFits ? "above" : "below";
	}
	const anchor = side === "above" ? first : last;
	return {
		position:
		{
			x: clampX(anchor.left + anchor.width / 2, bounds),
			y: clampY(side === "above" ? anchor.top - GAP - height : anchor.bottom + GAP, height),
		},
		side,
	};
}

export interface SelectionCommentCardProps
{
	/** What the card sits beside: the selection, or the mark being edited. */
	range: Range;
	/** The text the comment is on, copied by a copy with a bare caret. */
	selectedText: string;
	/** The pane root, whose rect clamps the card horizontally. */
	boundary: HTMLElement;
	/** The comment's text when opened; an outside press closes the card while the draft still matches it. */
	initialValue?: string;
	value: string;
	onChange: (value: string) => void;
	/** False when the save was refused, which keeps focus in the card. */
	onSave: (comment: string) => unknown;
	/** Editing an existing comment: shows Delete, and leaves the range unpainted as upstream does. */
	onDelete?: (() => void) | undefined;
	onClose: () => void;
	/** Upstream `side`: the plan popover prefers below, the reply card above. */
	side?: Side;
	/** The CSS highlight the range is painted with. */
	highlightName?: string;
	/** Upstream `showQuote`: the selected text shown over the editor. */
	quote?: string | undefined;
	inputLabel?: string;
	placeholder?: string;
	saveLabel?: string;
	/** Upstream `submitWhenEmpty`: Save and Enter work on a blank draft. */
	submitWhenEmpty?: boolean;
	/** Upstream `onChordSubmit`: ⌘/Ctrl+Enter, with the trimmed draft. */
	onChordSubmit?: ((text: string) => void) | undefined;
	/** Upstream `chordHint`: the chord's row under Save's tooltip. */
	chordHint?:
		|
		  {
				content: string;
				shortcut: string;
		  }
		| undefined;
	/** A send in flight: the draft is read-only and the actions are inert. */
	busy?: boolean;
	/** Upstream `restoreFocus`: focus goes back to where it was when the card closes. */
	restoreFocus?: boolean;
	/** Upstream `focusAfterSubmit`: where focus goes after a submit, instead of restoring it. */
	focusAfterSubmit?: (() => void) | undefined;
}

/**
 * Upstream's "Comment on selection" card (`Eu`/`Rg`): a fixed 320px card portalled to the body, holding the
 * shared comment editor in its floating variant. The plan pane uses it for plan comments, the transcript for
 * the inline reply card. It clears the window selection on open but keeps a new comment's range painted,
 * follows scroll and resize, closes on an outside press only while the draft is blank or unchanged, and
 * keeps Tab inside itself.
 */
export function SelectionCommentCard({
	range,
	selectedText,
	boundary,
	initialValue = "",
	value,
	onChange,
	onSave,
	onDelete,
	onClose,
	side = "below",
	highlightName = "plan-selection",
	quote,
	inputLabel = "Comment",
	placeholder,
	saveLabel,
	submitWhenEmpty = false,
	onChordSubmit,
	chordHint,
	busy = false,
	restoreFocus = false,
	focusAfterSubmit,
}: SelectionCommentCardProps)
{
	const dialogRef = useRef<HTMLDivElement>(null);
	// Unplaced, it stays focusable but invisible (not `visibility: hidden`, which would drop the autofocus).
	const [position, setPosition] = useState<Position | null>(null);
	const heldSide = useRef<Side | null>(null);
	// Read during the first render, before the editor's autofocus moves focus into the card.
	const [focusedBefore] = useState(() => (restoreFocus ? document.activeElement : null));
	const submitted = useRef(false);

	const editing = onDelete !== undefined;
	useLayoutEffect(() =>
	{
		document.getSelection()?.removeAllRanges();
		return editing ? undefined : paintSelection(highlightName, range);
	}, [range, editing, highlightName]);

	useEffect(
		() => () =>
		{
			if (submitted.current || !(focusedBefore instanceof HTMLElement) || !focusedBefore.isConnected) return;
			focusedBefore.focus();
		},
		[focusedBefore],
	);

	const reposition = useCallback(() =>
	{
		const height = dialogRef.current?.offsetHeight ?? 0;
		const bounds = boundary.getBoundingClientRect();
		if (side === "below")
		{
			setPosition(placeBelow(range, bounds, height));
			return;
		}
		const placed = placeAbove(range, bounds, height, heldSide.current);
		if (placed !== null) heldSide.current = placed.side;
		setPosition(placed?.position ?? null);
	}, [range, boundary, side]);

	useLayoutEffect(() =>
	{
		reposition();
		let frame = 0;
		const schedule = () =>
		{
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(reposition);
		};
		window.addEventListener("scroll", schedule, true);
		window.addEventListener("resize", schedule);
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
		observer?.observe(boundary);
		if (dialogRef.current !== null) observer?.observe(dialogRef.current);
		return () =>
		{
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", schedule, true);
			window.removeEventListener("resize", schedule);
			observer?.disconnect();
		};
	}, [reposition, boundary]);

	const unchanged = value.trim() === "" || value === initialValue;
	useEffect(() =>
	{
		const onPointerDown = (event: PointerEvent) =>
		{
			if (event.target instanceof Node && dialogRef.current?.contains(event.target) === true) return;
			if (unchanged) onClose();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () =>
		{
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [unchanged, onClose]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) =>
	{
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

	/** Copy or cut with a bare caret in the draft copies the selected text, as upstream does. */
	const onCopy = (event: ClipboardEvent<HTMLDivElement>) =>
	{
		const target = event.target;
		if (!(target instanceof HTMLTextAreaElement) || target.selectionStart !== target.selectionEnd) return;
		event.preventDefault();
		event.clipboardData.setData("text/plain", selectedText);
	};

	const afterSubmit = () =>
	{
		if (focusAfterSubmit === undefined) return;
		submitted.current = true;
		focusAfterSubmit();
	};

	return createPortal(
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a dialog traps Tab and copies the selection for the editor inside it
		<div
			ref={dialogRef}
			role="dialog"
			tabIndex={-1}
			aria-label="Comment on selection"
			data-surface="popover"
			className={CARD_CLASS}
			style={
				position === null
					?
						{
							opacity: 0,
							pointerEvents: "none",
						}
					:
						{
							transform: `translate(${position.x}px, ${position.y}px) translateX(-50%)`,
						}
			}
			onKeyDown={onKeyDown}
			onCopy={onCopy}
			onCut={onCopy}
		>
			<CommentEditor
				variant="floating"
				inputLabel={inputLabel}
				isEditing
				autoFocus
				value={value}
				onChange={onChange}
				inputReadOnly={busy}
				saveWhenEmpty={submitWhenEmpty}
				onSave={(text) =>
				{
					if (busy || onSave(text) === false) return;
					afterSubmit();
				}}
				{...(onChordSubmit === undefined
					? {}
					:
						{
							onChordEnter: (text: string) =>
							{
								if (busy || text === "") return;
								onChordSubmit(text);
								afterSubmit();
							},
						})}
				onCancel={onClose}
				onDelete={onDelete}
				{...(quote === undefined
					? {}
					:
						{
							label: <blockquote className={QUOTE_CLASS}>{quote}</blockquote>,
						})}
				{...(placeholder === undefined
					? {}
					:
						{
							placeholder,
						})}
				{...(saveLabel === undefined
					? {}
					:
						{
							saveLabel,
						})}
				{...(chordHint === undefined
					? {}
					:
						{
							saveSecondaryHint: chordHint,
						})}
				{...(value.trim() === "" && !submitWhenEmpty
					? {}
					:
						{
							saveShortcut: "enter",
						})}
			/>
		</div>,
		document.body,
	);
}
