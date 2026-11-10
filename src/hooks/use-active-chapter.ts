import {useEffect, useState, type RefObject} from "react";

import {
	ACTIVE_CHAPTER_BOTTOM_SLACK_PIXELS,
	chapterAnchorId,
	hasOutline,
	pickActiveChapter,
	type SessionChapter,
} from "../lib/session-chapters";

/** Upstream's `TO`: the reading line sits this far below the scroller's top. */
const READING_LINE_OFFSET_PIXELS = 64;
/** Upstream's `EO`: at the bottom, a scroll this soon after the last pass waits for a trailing pass instead. */
const TRAILING_PASS_MS = 50;

/** A transcript row, which names the first record it draws in `data-perf-line`. */
const ROW_SELECTOR = "[data-transcript-entry-index]";

/** Upstream's `Ci`: the first row reaching below the line, else the last row. */
function firstRowBelow(rows: Iterable<Element>, line: number): Element | undefined {
	let found: Element | undefined;
	for (const row of rows) {
		found = row;
		if (row.getBoundingClientRect().bottom > line) break;
	}
	return found;
}

/**
 * The id of the chapter being read, tracked from the transcript scroller (upstream's `kO`): one
 * pass per animation frame of scrolling, plus a trailing pass 50ms after one that landed at the
 * bottom. Null until the first pass, and for a session with no outline.
 *
 * The local scroller starts below the titlebar, so upstream's titlebar clearance (the scroll
 * padding of a scroller behind the title bar) is zero here.
 */
export function useActiveChapter({
	chapters,
	scrollRef,
	scrollKey,
}: {
	chapters: readonly SessionChapter[];
	scrollRef: RefObject<HTMLElement | null>;
	/** Changes when the scroller shows another visit, so the tracker re-reads it. */
	scrollKey: string;
}): string | null {
	const [active, setActive] = useState<string | null>(null);
	const enabled = hasOutline(chapters);

	useEffect(() => {
		const scroller = scrollRef.current;
		if (scroller === null || !enabled) return undefined;
		let frame = 0;
		let timer = 0;
		let retried = false;
		let lastPassAt = -Infinity;
		let lastDistance = 0;

		const pass = () => {
			frame = 0;
			if (timer !== 0) {
				window.clearTimeout(timer);
				timer = 0;
			}
			const firstRow = scroller.querySelector(ROW_SELECTOR);
			if (firstRow === null) {
				if (!retried) {
					retried = true;
					frame = requestAnimationFrame(pass);
				}
				return;
			}
			lastPassAt = performance.now();
			const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
			lastDistance = distance;
			const viewportTop = scroller.getBoundingClientRect().top + READING_LINE_OFFSET_PIXELS;
			const visibleRow =
				(distance > ACTIVE_CHAPTER_BOTTOM_SLACK_PIXELS
					? firstRowBelow(scroller.querySelectorAll(ROW_SELECTOR), viewportTop)
					: undefined) ?? firstRow;
			const next = pickActiveChapter(chapters, {
				canScroll: scroller.scrollHeight > scroller.clientHeight,
				distanceToBottomPx: distance,
				viewportTopPx: viewportTop,
				firstVisibleRecordIndex: Number(visibleRow.getAttribute("data-perf-line") ?? -1),
				getAnchorTop: (chapter) => {
					const anchor = document.getElementById(chapterAnchorId(chapter.id));
					return anchor !== null && scroller.contains(anchor) ? anchor.getBoundingClientRect().top : null;
				},
			});
			setActive(next);
		};

		const onScroll = () => {
			if (frame !== 0) return;
			if (
				lastDistance <= ACTIVE_CHAPTER_BOTTOM_SLACK_PIXELS &&
				performance.now() - lastPassAt < TRAILING_PASS_MS
			) {
				if (timer === 0) {
					timer = window.setTimeout(() => {
						timer = 0;
						if (frame === 0) frame = requestAnimationFrame(pass);
					}, TRAILING_PASS_MS);
				}
				return;
			}
			frame = requestAnimationFrame(pass);
		};

		scroller.addEventListener("scroll", onScroll, {passive: true});
		pass();
		return () => {
			scroller.removeEventListener("scroll", onScroll);
			if (frame !== 0) cancelAnimationFrame(frame);
			if (timer !== 0) window.clearTimeout(timer);
		};
	}, [scrollRef, scrollKey, chapters, enabled]);

	return active;
}
