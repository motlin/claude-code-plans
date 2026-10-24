import {Fragment, type RefObject, useEffect, useLayoutEffect, useRef, useState} from "react";

import {type TranscriptSelection, useTranscriptSelection} from "../hooks/use-transcript-selection";
import {attachContext, hasComposer} from "../lib/context-attach";
import {openSideChatWithContext, useSideChat} from "../lib/side-chat-store";
import {findScrollContainer} from "./scroll-container";
import {ViewportPortal} from "./viewport-portal";

/** Upstream `Xl`: the gap between the selection and the bar. */
const BAR_GAP = 8;
/** Upstream `Zl`: the bar's inset from the transcript's edges. */
const EDGE_INSET = 12;
/** Upstream `Yl`: how far the selection may scroll before the bar gives up. */
const HIDE_AFTER_SCROLL = 100;
/** Upstream's side chat excerpt cap, shared by Reply. */
const EXCERPT_MAX_LENGTH = 1500;

const HOST_CLASS =
	"text-body text-primary break-words pointer-events-auto fixed left-0 top-0 will-change-transform isolate";
const BAR_CLASS = "rounded-r5 bg-surface-3 shadow-[var(--menu-shadow)] group/split flex";
/** Upstream's cds ghost Button: 24px tall, 8px inline padding, 6px radius, ghost hover paint. */
const BUTTON_CLASS =
	"inline-flex h-6 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-r5 px-2 text-body font-normal text-primary select-none outline-none hover:bg-fill-ghost-hover focus-visible:shadow-focus";
const SEPARATOR_CLASS =
	"w-px my-[7px] bg-alpha-2 shrink-0 transition-opacity motion-reduce:transition-none group-hover/split:opacity-0 group-focus-within/split:opacity-0";

interface BarAction {
	label: string;
	run: (text: string) => void;
}

function truncateExcerpt(text: string): string {
	return text.length > EXCERPT_MAX_LENGTH ? `${text.slice(0, EXCERPT_MAX_LENGTH)}…` : text;
}

function clearSelection(doc: Document): void {
	doc.getSelection()?.removeAllRanges();
}

/** The selection's first line, which the bar centres on like upstream `Ql`. */
function firstLineRect(range: Range): DOMRect {
	return range.getClientRects()[0] ?? range.getBoundingClientRect();
}

/** The visible bounds the bar stays inside: the transcript scroller, or the viewport when the document scrolls. */
function boundsOf(container: Element): {left: number; right: number; top: number} {
	const scroller = findScrollContainer(container);
	if (scroller === document.scrollingElement || scroller === document.documentElement)
		return {left: 0, right: window.innerWidth, top: 0};
	const {left, right, top} = scroller.getBoundingClientRect();
	return {left, right, top};
}

/** Upstream `Ql`'s placement: centred on the first line, clamped inside the bounds, above when it fits. */
function placeBar(range: Range, bar: Element, container: Element): {x: number; y: number; top: number} {
	const line = firstLineRect(range);
	const {width, height} = bar.getBoundingClientRect();
	const bounds = boundsOf(container);
	const min = bounds.left + width / 2 + EDGE_INSET;
	const max = bounds.right - width / 2 - EDGE_INSET;
	const x = Math.min(Math.max(line.left + line.width / 2, min), Math.max(min, max));
	const above = line.top - height - BAR_GAP;
	const y = above >= bounds.top + EDGE_INSET ? above : line.bottom + BAR_GAP;
	return {x: Math.round(x), y: Math.round(y), top: line.top};
}

/** Whether any menu popup is open, under which upstream hides the bar but keeps it mounted. */
function useAnyMenuOpen(active: boolean): boolean {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (!active) return undefined;
		const check = () => {
			setOpen(document.querySelector('[role="menu"]') !== null);
		};
		check();
		const observer = new MutationObserver(check);
		observer.observe(document.body, {childList: true, subtree: true});
		return () => {
			observer.disconnect();
		};
	}, [active]);
	return active && open;
}

/**
 * Upstream's transcript selection bar (`ZS`/`Ql`/`Hs`): a floating
 * "Start a side chat · Reply" pair above a transcript selection.
 */
export function TranscriptSelectionBar({
	sessionId,
	containerRef,
	sideChatAvailable,
}: {
	sessionId: string;
	containerRef: RefObject<Element | null>;
	sideChatAvailable: boolean;
}) {
	const selection = useTranscriptSelection(containerRef);
	const sideChat = useSideChat(sessionId);
	const [dismissed, setDismissed] = useState<TranscriptSelection | null>(null);
	const shown = selection !== null && selection !== dismissed ? selection : null;
	const menuOpen = useAnyMenuOpen(shown !== null);

	const actions: BarAction[] = [];
	const sideChatBusy = sideChat.entries.some((entry) => entry.status === "pending");
	if (sideChatAvailable && !sideChatBusy)
		actions.push({
			label: sideChat.open ? "Send to side chat" : "Start a side chat",
			run: (text) => {
				openSideChatWithContext(sessionId, truncateExcerpt(text));
			},
		});
	if (hasComposer(sessionId))
		actions.push({
			label: "Reply",
			run: (text) => attachContext(sessionId, {kind: "excerpt", text: truncateExcerpt(text)}),
		});

	if (shown === null || actions.length === 0) return null;
	return (
		<ViewportPortal>
			<SelectionBarHost
				selection={shown}
				containerRef={containerRef}
				actions={actions}
				hidden={menuOpen}
				onHide={() => {
					setDismissed(shown);
				}}
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
}) {
	const barRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{x: number; y: number} | null>(null);
	const onHideRef = useRef(onHide);
	onHideRef.current = onHide;

	useLayoutEffect(() => {
		const bar = barRef.current;
		const container = containerRef.current;
		if (bar === null || container === null) return undefined;
		const initial = placeBar(selection.range, bar, container);
		setPosition(initial);
		let frame: number | undefined;
		let scheduled = false;
		const reposition = () => {
			if (scheduled) return;
			scheduled = true;
			frame = requestAnimationFrame(() => {
				scheduled = false;
				const next = placeBar(selection.range, bar, container);
				if (Math.abs(next.top - initial.top) > HIDE_AFTER_SCROLL) onHideRef.current();
				else setPosition(next);
			});
		};
		document.addEventListener("scroll", reposition, {capture: true, passive: true});
		window.addEventListener("resize", reposition);
		return () => {
			if (scheduled && frame !== undefined) cancelAnimationFrame(frame);
			document.removeEventListener("scroll", reposition, true);
			window.removeEventListener("resize", reposition);
		};
	}, [selection, containerRef]);

	const run = (action: BarAction) => {
		action.run(selection.text);
		clearSelection(selection.range.startContainer.ownerDocument ?? document);
		onHide();
	};

	return (
		<div
			data-transcript-selection-host=""
			className={HOST_CLASS}
			style={{
				zIndex: 55,
				transform:
					position === null ? undefined : `translate(${position.x}px, ${position.y}px) translateX(-50%)`,
				...(hidden || position === null ? {visibility: "hidden"} : {}),
			}}
		>
			<div ref={barRef} data-transcript-selection-bar="" className={BAR_CLASS}>
				{actions.map((action, index) => (
					<Fragment key={action.label}>
						{index > 0 && <span aria-hidden="true" className={SEPARATOR_CLASS} />}
						<button
							type="button"
							className={BUTTON_CLASS}
							onMouseDown={(event) => {
								event.preventDefault();
							}}
							onClick={() => {
								run(action);
							}}
						>
							{action.label}
						</button>
					</Fragment>
				))}
			</div>
		</div>
	);
}
