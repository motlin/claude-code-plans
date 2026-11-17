import {useEffect, type RefObject} from "react";

import
{
	createReadLatch,
	endLineHeight,
	fits,
	inset,
	lineSeen,
	nearestScroller,
	type ReadGateState,
	readLinesSeen,
	cardReadLines,
	watchReadGate,
	windowOf,
} from "../lib/read-gate";

/**
 * Upstream's rows read gate (claude.ai/code c623a1c74 `E`): reports `read` once the watched panel's head line, its
 * first row (unless the head is that line) and its end line box have each been seen, plus every read-line in the
 * card. Each sighting goes through the two-frame latch, so a pending one reports `waiting`. Lines clipped by any
 * scrolling ancestor (the card body, the transcript, scroll-padding, the sticky prompt's `topCover`) are not seen.
 * After each measured pass `onFits` says whether the nearest scroller shows everything. `watched` false or a
 * changed `gateKey` starts afresh.
 */
export function useRowsReadGate({
	ref,
	watched,
	gateKey,
	headIsFirstLine = false,
	topCover,
	onReadState,
	onFits,
}: {
	ref: RefObject<HTMLElement | null>;
	watched: boolean;
	/** The gated text's identity: a new key starts unread. */
	gateKey: string;
	/** Upstream's change-target lead: the head line is the first line, so no first row is required. */
	headIsFirstLine?: boolean;
	/** The sticky prompt's overlap of the transcript top; locally there is none yet. */
	topCover?: () => number;
	onReadState: (state: ReadGateState) => void;
	onFits?: (fits: boolean) => void;
}): void
{
	useEffect(() =>
	{
		const element = ref.current;
		const win = windowOf(element);
		if (!watched) return undefined;
		if (element === null || win === null)
		{
			onReadState("read");
			return undefined;
		}
		let rerun: (() => void) | null = null;
		const latch = createReadLatch(element, win, () => rerun?.());
		const check = (report: (state: ReadGateState) => void) =>
		{
			rerun ??= () =>
			{
				check(report);
			};
			if (element.clientHeight === 0)
			{
				report("unlaid");
				return;
			}
			const lineHeight = Number.parseFloat(win.getComputedStyle(element).lineHeight);
			if (!Number.isFinite(lineHeight))
			{
				report("unread");
				return;
			}
			const fitsNow = fits(nearestScroller(element, win));
			latch.pass();
			const firstRow = headIsFirstLine ? null : element.querySelector("li");
			const cover = Math.max(0, topCover?.() ?? 0);
			const head = latch.seen("head", () =>
				lineSeen(element, win, lineHeight, "first", inset(element, win, "first"), cover),
			);
			const row =
				firstRow === null ||
				latch.seen("firstRow", () => lineSeen(firstRow, win, lineHeight, "first", 0, cover));
			const end = latch.seen("end", () =>
				lineSeen(element, win, endLineHeight(element, win, lineHeight), "last", 0, cover),
			);
			const lines = readLinesSeen(cardReadLines(element), win, latch.seen, true, cover);
			report(head && row && end && lines ? (latch.waiting() ? "waiting" : "read") : "unread");
			onFits?.(fitsNow);
		};
		const watch = watchReadGate(element, win, [], check, onReadState);
		return () =>
		{
			rerun = null;
			latch.forget();
			watch.stop();
		};
	}, [ref, watched, gateKey, headIsFirstLine, topCover, onReadState, onFits]);
}
