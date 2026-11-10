import {useEffect, useRef, useState, type WheelEvent as ReactWheelEvent} from "react";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";

/** A prompt the bubble can show: its transcript entry and its tail-clipped, masked text. */
export interface StickyPromptCandidate {
	key: string;
	index: number;
	text: string;
}

/** Upstream `Ww`: the line sits 24px below the scroller's top edge. */
const STICKY_PROMPT_LINE_OFFSET = 24;
/** Upstream `Kw`: within 8px of the bottom, nothing shows. */
const STICKY_PROMPT_BOTTOM_SLACK = 8;
/** Upstream `Hw`, written on the overlay host for chips and sticky bars that sit below the bubble. */
const STICKY_PROMPT_END_VAR = "--epitaxy-sticky-prompt-end";

/** Upstream `F_`: the first element whose bottom passes the line, else the last one. */
function firstPastLine(elements: readonly Element[], line: number): Element | undefined {
	let found: Element | undefined;
	for (const element of elements) {
		found = element;
		if (element.getBoundingClientRect().bottom > line) break;
	}
	return found;
}

/**
 * Upstream's `$w` detection walk: the latest prompt that has fully scrolled
 * past the line, or null while it still straddles the line, near the bottom,
 * or when the scroller is not displayed.
 */
function currentPromptKey(scroller: HTMLElement, candidates: readonly StickyPromptCandidate[]): string | null {
	if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= STICKY_PROMPT_BOTTOM_SLACK) return null;
	// The session header sits above the scroller, so no scroll padding covers its top edge.
	const line = scroller.getBoundingClientRect().top + STICKY_PROMPT_LINE_OFFSET;
	const candidateByIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));
	const rows = new Map<string, Element>();
	const mounted: Element[] = [];
	for (const row of scroller.querySelectorAll("[data-transcript-entry-index]")) {
		const candidate = candidateByIndex.get(Number(row.getAttribute("data-transcript-entry-index")));
		if (candidate === undefined) continue;
		mounted.push(row);
		if (!rows.has(candidate.key)) rows.set(candidate.key, row);
	}
	const anchorRow = firstPastLine(mounted, line);
	const anchor =
		anchorRow === undefined ? -1 : Number(anchorRow.getAttribute("data-transcript-entry-index") ?? Number.NaN);
	let current: StickyPromptCandidate | null = null;
	let straddling = false;
	for (const candidate of candidates) {
		const row = rows.get(candidate.key);
		if (!row) {
			if (anchor >= 0 && candidate.index < anchor) {
				current = candidate;
				straddling = false;
				continue;
			}
			break;
		}
		const box = row.getBoundingClientRect();
		const paddingBottom = Number.parseFloat(getComputedStyle(row).paddingBottom) || 0;
		if (box.top > line) break;
		current = candidate;
		straddling = box.bottom - paddingBottom > line;
	}
	return current !== null && !straddling ? current.key : null;
}

/** Upstream ca80fca8d `Pi`: the pixels one wheel step scrolls for each deltaMode. */
function wheelUnit(deltaMode: number): number {
	return deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1;
}

/**
 * Upstream cf74bc599 `$w`: once a prompt scrolls past the top of the
 * transcript, a one-line peek of its tail stays pinned there. Hover or focus
 * opens it to five lines, a click scrolls back to the prompt, and a wheel over
 * it still scrolls the transcript.
 */
export function StickyPromptOverlay({
	candidates,
	scroller: getScroller,
	scrollToEntry,
}: {
	candidates: readonly StickyPromptCandidate[];
	scroller: () => Element | null;
	scrollToEntry: (index: number, behavior: ScrollBehavior) => void;
}) {
	const [shownKey, setShownKey] = useState<string | null>(null);
	const candidatesRef = useRef(candidates);
	candidatesRef.current = candidates;
	const getScrollerRef = useRef(getScroller);
	getScrollerRef.current = getScroller;
	const overlayRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const scroller = getScrollerRef.current();
		if (!(scroller instanceof HTMLElement) || candidates.length === 0) {
			setShownKey(null);
			return undefined;
		}
		let frame = 0;
		const detect = () => {
			frame = 0;
			if (scroller.offsetParent === null) return;
			setShownKey(currentPromptKey(scroller, candidatesRef.current));
		};
		const schedule = () => {
			frame ||= requestAnimationFrame(detect);
		};
		scroller.addEventListener("scroll", schedule, {passive: true});
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
		observer?.observe(scroller);
		if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild);
		detect();
		return () => {
			scroller.removeEventListener("scroll", schedule);
			observer?.disconnect();
			if (frame) cancelAnimationFrame(frame);
			setShownKey(null);
		};
	}, [candidates.length]);

	const shown = shownKey === null ? undefined : candidates.find((candidate) => candidate.key === shownKey);
	const visible = shown !== undefined;

	// Upstream `Uw`: while shown, the overlay's bottom edge is published on its host.
	useEffect(() => {
		const overlay = overlayRef.current;
		const host = overlay?.closest<HTMLElement>("[data-transcript-overlay-host]") ?? overlay?.parentElement;
		if (!visible || !overlay || !host) return undefined;
		const write = () => {
			const end = `${overlay.getBoundingClientRect().bottom - host.getBoundingClientRect().top}px`;
			if (host.style.getPropertyValue(STICKY_PROMPT_END_VAR) !== end)
				host.style.setProperty(STICKY_PROMPT_END_VAR, end);
		};
		write();
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(write);
		observer?.observe(overlay);
		return () => {
			observer?.disconnect();
			host.style.removeProperty(STICKY_PROMPT_END_VAR);
		};
	}, [visible]);

	if (shown === undefined) return null;

	const forwardWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
		const scroller = getScroller();
		if (!scroller || event.ctrlKey) return;
		scroller.dispatchEvent(new WheelEvent(event.type, event.nativeEvent));
		const unit = wheelUnit(event.deltaMode);
		scroller.scrollBy({top: event.deltaY * unit, left: event.deltaX * unit});
	};

	return (
		<div
			ref={overlayRef}
			className="absolute top-0 inset-x-0 z-[12] pointer-events-none draggable-none"
			onWheel={forwardWheel}
		>
			<div className={`epitaxy-transcript-typography ${CHAT_COLUMN_CLASS} flex justify-start`}>
				<button
					type="button"
					onClick={() => {
						scrollToEntry(shown.index, "smooth");
					}}
					aria-label="Scroll to your message"
					className="epitaxy-sticky-prompt-clip hide-focus-ring pointer-events-auto max-w-[85%] min-w-0"
				>
					<span className="epitaxy-sticky-prompt-bubble">{shown.text}</span>
				</button>
			</div>
		</div>
	);
}
