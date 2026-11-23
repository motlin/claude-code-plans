import
{
	type ComponentProps,
	Fragment,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {useIsMac} from "../hooks/use-is-mac";
import {type TranscriptSelection, useTranscriptSelection} from "../hooks/use-transcript-selection";
import {attachContext, attachReply, focusComposer, formatReply, hasComposer} from "../lib/context-attach";
import {INLINE_REPLY_ENABLED} from "../lib/inline-reply";
import {toAriaKeyShortcuts} from "../lib/shortcuts/format";
import {openSideChatWithContext, useSideChat} from "../lib/side-chat-store";
import {findScrollContainer} from "./scroll-container";
import {SelectionCommentCard} from "./selection-comment-card";
import {ToastContext, type ToastOptions} from "./toast-context";
import {TurnUndoSendContext} from "./turn-undo-send-context";
import {FORCED_COLORS_BORDER_CLASS} from "./ui/popover-surface";
import {ViewportPortal} from "./viewport-portal";

/** Upstream `Xl`: the gap between the selection and the bar. */
const BAR_GAP = 8;
/** Upstream `Zl`: the bar's inset from the transcript's edges. */
const EDGE_INSET = 12;
/** Upstream `Yl`: how far the selection may scroll before the bar gives up. */
const HIDE_AFTER_SCROLL = 100;
/** Upstream's side chat excerpt cap, shared by Quote. */
const EXCERPT_MAX_LENGTH = 1500;

const HOST_CLASS =
	"text-body text-primary break-words pointer-events-auto fixed left-0 top-0 will-change-transform isolate draggable-none";
/** The floating selection action bar shared with the diff selection chip (upstream `Ml`/`sn`): radius 6px compact, 8px comfortable. */
export const SELECTION_BAR_CLASS = `rounded-r5 bg-surface-3 shadow-[var(--menu-shadow)] ${FORCED_COLORS_BORDER_CLASS} group/split flex comfortable:rounded-r6`;
/** Upstream's cds ghost Button: 24px / 8px / 6px compact, 28px / 12px / 8px comfortable; the hover lives on the paint layer. */
const SELECTION_BAR_BUTTON_CLASS =
	"cds-reset group/btn relative isolate inline-flex h-6 shrink-0 items-center justify-center whitespace-nowrap rounded-r5 px-2 text-body font-control-regular text-primary select-none outline-none focus-visible:shadow-focus comfortable:h-7 comfortable:px-3 comfortable:rounded-r6";
const PAINT_LAYER_CLASS = "absolute -z-[1] rounded-[inherit] inset-0";
/** Upstream's ghost paint under fizzy-lake `color` (`stacks:`): a 60ms box-shadow/color transition and the button ghost hover. */
const PAINT_CLASS =
	"absolute inset-0 rounded-[inherit] bg-transparent transition-[box-shadow,color] duration-[60ms] ease-[cubic-bezier(.165,.84,.44,1)] group-hover/btn:bg-fill-button-ghost-hover group-focus-visible/btn:shadow-[inset_0_0_0_1px_var(--cds-page-bg)]";
const LABEL_CLASS = "inline-flex min-w-0 items-center gap-1";

/** One action of the selection bar or diff chip: upstream's cds ghost `Button` with its paint layer and label. */
export function SelectionBarButton({children, ...props}: Omit<ComponentProps<"button">, "type" | "className">)
{
	return (
		<button type="button" data-cds="Button" data-cds-ghost="" className={SELECTION_BAR_BUTTON_CLASS} {...props}>
			<span aria-hidden="true" className={PAINT_LAYER_CLASS}>
				<span data-cds-part="paint" className={PAINT_CLASS} />
			</span>
			<span className={LABEL_CLASS}>{children}</span>
		</button>
	);
}
const SEPARATOR_CLASS =
	"w-px my-[7px] bg-alpha-2 shrink-0 transition-opacity motion-reduce:transition-none group-hover/split:opacity-0 group-focus-within/split:opacity-0";

interface BarAction
{
	label: string;
	/** Upstream `aE`'s `shortcut`, set on the button as `aria-keyshortcuts`. */
	shortcut?: string;
	run: (selection: TranscriptSelection) => void;
}

/** Upstream's inline reply card state (`P`): the quoted range, its entry and the draft. */
interface ReplyDraft
{
	range: Range;
	quote: string;
	entryKey: string;
	comment: string;
}

const NO_COMPOSER_MESSAGE = "Can\u2019t add to your prompt until the message box is back.";
const CHORD_HINT =
{
	content: "Send reply",
	shortcut: "cmd+enter",
};

/** The transcript entry a node sits in (upstream `Lg`, which reads `data-entry-key`). */
function entryKeyOf(node: Node): string | null
{
	const element = node instanceof Element ? node : node.parentElement;
	return element?.closest("[data-transcript-entry-index]")?.getAttribute("data-transcript-entry-index") ?? null;
}

/** The entry both ends of the selection sit in, or null when it spans two (upstream `ie`). */
function selectionEntryKey(range: Range): string | null
{
	const first = entryKeyOf(range.startContainer);
	return first !== null && first === entryKeyOf(range.endContainer) ? first : null;
}

/** Upstream `kt`/`Zt`/`$t`: a field, a menu or a dialog keeps its own Enter. */
function ownsEnter(target: EventTarget | null): boolean
{
	if (!(target instanceof Element)) return false;
	if (target instanceof HTMLElement && target.isContentEditable) return true;
	return target.closest('input, textarea, select, [role="menu"], [role="dialog"], [role="alertdialog"]') !== null;
}

/** Upstream `Ot(doc, null, {skipIdleToasts})`: an open menu or dialog anywhere. */
function overlayOpen(doc: Document): boolean
{
	return doc.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"]') !== null;
}

function truncateExcerpt(text: string): string
{
	return text.length > EXCERPT_MAX_LENGTH ? `${text.slice(0, EXCERPT_MAX_LENGTH)}…` : text;
}

function clearSelection(doc: Document): void
{
	doc.getSelection()?.removeAllRanges();
}

/** The selection's first line, which the bar centres on like upstream `Ql`. */
function firstLineRect(range: Range): DOMRect
{
	return range.getClientRects()[0] ?? range.getBoundingClientRect();
}

/** The visible bounds the bar stays inside: the transcript scroller, or the viewport when the document scrolls. */
function boundsOf(container: Element):
{
	left: number;
	right: number;
	top: number;
}
{
	const scroller = findScrollContainer(container);
	if (scroller === document.scrollingElement || scroller === document.documentElement)
		return {
			left: 0,
			right: window.innerWidth,
			top: 0,
		};
	const {left, right, top} = scroller.getBoundingClientRect();
	return {
		left,
		right,
		top,
	};
}

/** Upstream `Ql`'s placement: centred on the first line, clamped inside the bounds, above when it fits. */
function placeBar(
	range: Range,
	bar: Element,
	container: Element,
):
{
	x: number;
	y: number;
	top: number;
}
{
	const line = firstLineRect(range);
	const {width, height} = bar.getBoundingClientRect();
	const bounds = boundsOf(container);
	const min = bounds.left + width / 2 + EDGE_INSET;
	const max = bounds.right - width / 2 - EDGE_INSET;
	const x = Math.min(Math.max(line.left + line.width / 2, min), Math.max(min, max));
	const above = line.top - height - BAR_GAP;
	const y = above >= bounds.top + EDGE_INSET ? above : line.bottom + BAR_GAP;
	return {
		x: Math.round(x),
		y: Math.round(y),
		top: line.top,
	};
}

/** Whether any menu popup is open, under which upstream hides the bar but keeps it mounted. */
function useAnyMenuOpen(active: boolean): boolean
{
	const [open, setOpen] = useState(false);
	useEffect(() =>
	{
		if (!active) return undefined;
		const check = () =>
		{
			setOpen(document.querySelector('[role="menu"]') !== null);
		};
		check();
		const observer = new MutationObserver(check);
		observer.observe(
			document.body,
			{
				childList: true,
				subtree: true,
			},
		);
		return () =>
		{
			observer.disconnect();
		};
	}, [active]);
	return active && open;
}

/**
 * Upstream's transcript selection bar (`ZS`/`Ql`/`Hs`): a floating
 * "Start a side chat · Quote" pair above a transcript selection.
 */
export function TranscriptSelectionBar({
	sessionId,
	containerRef,
	sideChatAvailable,
	inlineReply = INLINE_REPLY_ENABLED,
}: {
	sessionId: string;
	containerRef: RefObject<Element | null>;
	sideChatAvailable: boolean;
	/** Upstream's `inlineReplyEnabled` (defaults to `INLINE_REPLY_ENABLED`): Reply opens the reply card. */
	inlineReply?: boolean;
})
{
	const {selection: shown, hide} = useTranscriptSelection(containerRef);
	const sideChat = useSideChat(sessionId);
	const [reply, setReply] = useState<ReplyDraft | null>(null);
	const barShown = shown !== null && reply === null;
	const menuOpen = useAnyMenuOpen(barShown);
	const toast = useContext(ToastContext);
	const send = useContext(TurnUndoSendContext);

	const openReply = useCallback((selection: TranscriptSelection) =>
	{
		const entryKey = selectionEntryKey(selection.range);
		if (entryKey === null) return;
		setReply(
			{
				range: selection.range,
				quote: truncateExcerpt(selection.text),
				entryKey,
				comment: "",
			},
		);
	}, []);

	const actions: BarAction[] = [];
	const sideChatBusy = sideChat.entries.some((entry) => entry.status === "pending");
	if (sideChatAvailable && !sideChatBusy)
		actions.push(
			{
				label: sideChat.open ? "Send to side chat" : "Start a side chat",
				run: ({text}) =>
				{
					openSideChatWithContext(sessionId, truncateExcerpt(text));
				},
			},
		);
	const canReply =
		hasComposer(sessionId) && (!inlineReply || (shown !== null && selectionEntryKey(shown.range) !== null));
	if (canReply)
		actions.push(
			inlineReply
				?
					{
						label: "Quote",
						shortcut: "enter",
						run: openReply,
					}
				:
					{
						label: "Quote",
						run: ({text}) =>
							attachContext(
								sessionId,
								{
									kind: "excerpt",
									text: truncateExcerpt(text),
								},
							),
					},
		);

	// Upstream `sl`: a plain Enter anywhere but a field, menu or dialog replies while the bar shows.
	const enterReplies = barShown && canReply && inlineReply;
	useEffect(() =>
	{
		if (!enterReplies) return undefined;
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (
				event.key !== "Enter" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				event.shiftKey ||
				event.repeat ||
				event.isComposing ||
				event.defaultPrevented ||
				ownsEnter(event.target) ||
				overlayOpen(document)
			)
				return;
			const container = containerRef.current;
			if (container === null || !container.contains(shown.range.commonAncestorContainer)) return;
			event.preventDefault();
			openReply(shown);
			document.getSelection()?.removeAllRanges();
		};
		document.addEventListener("keydown", onKeyDown);
		return () =>
		{
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [enterReplies, shown, containerRef, openReply]);

	const notify = (options: ToastOptions) =>
	{
		toast?.(options);
	};

	const boundary = containerRef.current;
	const card =
		reply === null || !(boundary instanceof HTMLElement) ? null : (
			<SelectionCommentCard
				range={reply.range}
				selectedText={reply.quote}
				boundary={boundary}
				value={reply.comment}
				onChange={(comment) =>
				{
					setReply(
						{
							...reply,
							comment,
						},
					);
				}}
				side="above"
				highlightName="reply-selection"
				quote={reply.quote}
				inputLabel="Reply"
				placeholder="Reply to Claude"
				saveLabel="Add to prompt"
				submitWhenEmpty
				restoreFocus
				focusAfterSubmit={() =>
				{
					focusComposer(sessionId);
				}}
				// Upstream `xe` (Add to prompt): a blank comment attaches a plain Excerpt, else a reply chip.
				onSave={(comment) =>
				{
					if (!hasComposer(sessionId))
					{
						notify(
							{
								kind: "error",
								message: NO_COMPOSER_MESSAGE,
							},
						);
						return false;
					}
					if (!attachReply(sessionId, reply.quote, comment, notify)) return false;
					setReply(null);
					return true;
				}}
				// Upstream `me` (Send reply, ⌘⏎): the reply prompt goes out now, steering a running turn.
				{...(send === null
					? {}
					:
						{
							onChordSubmit: (comment: string) =>
							{
								send(formatReply(reply.quote, comment));
								setReply(null);
							},
							chordHint: CHORD_HINT,
						})}
				onClose={() =>
				{
					setReply(null);
				}}
			/>
		);

	if (!barShown || actions.length === 0) return card;
	return (
		<ViewportPortal>
			<SelectionBarHost
				selection={shown}
				containerRef={containerRef}
				actions={actions}
				hidden={menuOpen}
				onHide={hide}
			/>
		</ViewportPortal>
	);
}

function SelectionBarHost({
	selection,
	containerRef,
	actions,
	hidden,
	onHide,
}: {
	selection: TranscriptSelection;
	containerRef: RefObject<Element | null>;
	actions: readonly BarAction[];
	hidden: boolean;
	onHide: () => void;
})
{
	const barRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<
	{
		x: number;
		y: number;
	} | null>(null);
	const onHideRef = useRef(onHide);
	onHideRef.current = onHide;

	useLayoutEffect(() =>
	{
		const bar = barRef.current;
		const container = containerRef.current;
		if (bar === null || container === null) return undefined;
		const initial = placeBar(selection.range, bar, container);
		setPosition(initial);
		let frame: number | undefined;
		let scheduled = false;
		const reposition = () =>
		{
			if (scheduled) return;
			scheduled = true;
			frame = requestAnimationFrame(() =>
			{
				scheduled = false;
				const next = placeBar(selection.range, bar, container);
				if (Math.abs(next.top - initial.top) > HIDE_AFTER_SCROLL) onHideRef.current();
				else setPosition(next);
			});
		};
		document.addEventListener(
			"scroll",
			reposition,
			{
				capture: true,
				passive: true,
			},
		);
		window.addEventListener("resize", reposition);
		return () =>
		{
			if (scheduled && frame !== undefined) cancelAnimationFrame(frame);
			document.removeEventListener("scroll", reposition, true);
			window.removeEventListener("resize", reposition);
		};
	}, [selection, containerRef]);

	const isMac = useIsMac();
	const run = (action: BarAction) =>
	{
		action.run(selection);
		clearSelection(selection.range.startContainer.ownerDocument ?? document);
		onHide();
	};

	return (
		<div
			data-transcript-selection-host=""
			className={HOST_CLASS}
			style={
			{
				zIndex: 55,
				transform:
					position === null ? undefined : `translate(${position.x}px, ${position.y}px) translateX(-50%)`,
				...(position === null
					?
						{
							visibility: "hidden",
						}
					: {}),
			}}
		>
			<div
				ref={barRef}
				data-transcript-selection-bar=""
				data-surface="popover"
				className={SELECTION_BAR_CLASS}
				style={
					hidden
						?
							{
								visibility: "hidden",
							}
						: undefined
				}
			>
				{actions.map((action, index) => (
					<Fragment key={action.label}>
						{index > 0 && <span aria-hidden="true" className={SEPARATOR_CLASS} />}
						<SelectionBarButton
							aria-keyshortcuts={
								action.shortcut === undefined ? undefined : toAriaKeyShortcuts(action.shortcut, isMac)
							}
							onMouseDown={(event) =>
							{
								event.preventDefault();
							}}
							onClick={() =>
							{
								run(action);
							}}
						>
							{action.label}
						</SelectionBarButton>
					</Fragment>
				))}
			</div>
		</div>
	);
}
