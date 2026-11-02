import {useEffect, useRef, type RefObject} from "react";

import
{
	approvalCardOf,
	createReadLatch,
	endLineHeight,
	inset,
	lineSeen,
	type ReadGateState,
	visibleClip,
	watchReadGate,
	windowOf,
} from "../lib/read-gate";

/** Upstream's slack: a line box may sit 2px outside the visible box and still count as seen. */
const SLACK = 2;

/**
 * `held`: the gated text is not read yet. `quiet`: held only because its head is scrolled away and the card has
 * not settled yet, so no hint should show. `upward`: the unread part is above, so the hint says "Scroll up".
 */
export type ReadGateHeld = (held: boolean, quiet?: boolean, upward?: boolean) => void;

/**
 * Upstream `v`: a ref the gate fills with its re-kick (forget every sighting and re-observe), called whenever
 * `signal` (upstream: the approval presentation) changes, so a card that moves between dock and inline starts
 * unread again.
 */
function useReadGateKick(signal: unknown): RefObject<(() => void) | null>
{
	const kick = useRef<(() => void) | null>(null);
	useEffect(() =>
	{
		kick.current?.();
	}, [signal]);
	return kick;
}

/**
 * Upstream `y`, the plan and title read gate. Holds while the watched element's end has not been seen (and, with
 * `hostClips`, its head too), each sighting confirmed by the two-frame latch. Without `inScroller` or `hostClips`
 * an element that fits is read at once. A missing line height holds an in-scroller or host-clipped gate as unlaid.
 * With `hostClips`, a card on screen whose head is scrolled past reports a quiet upward hold until two frames and a
 * microtask later, so a card that mounts with its head already scrolled away hints one settle after mounting.
 */
export function useReadGate({
	ref,
	watched,
	text,
	inScroller = false,
	hostClips = false,
	topCover,
	presentation,
	onHeld,
}: {
	ref: RefObject<HTMLElement | null>;
	watched: boolean;
	/** The gated text's identity: a new text starts unread. */
	text: string | undefined;
	/** The watched element is a scroller of its own: its end box adds the bottom inset, and fitting is not read. */
	inScroller?: boolean;
	/** The card clips the watched element: its head must be seen too. */
	hostClips?: boolean;
	/** The sticky prompt's overlap of the transcript top; locally there is none yet. */
	topCover?: () => number;
	/** The approval presentation; a change re-kicks the gate. */
	presentation?: "card" | "dock";
	onHeld: ReadGateHeld;
}): void
{
	const kick = useReadGateKick(presentation);
	useEffect(() =>
	{
		const element = ref.current;
		const win = windowOf(element);
		if (!watched || element === null || win === null)
		{
			onHeld(false);
			return undefined;
		}
		let rerun: (() => void) | null = null;
		const latch = createReadLatch(element, win, () => rerun?.());
		let headUnseen = false;
		let endSeen = false;
		let cardOnScreen = true;
		let headPassed = false;
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
			if (!inScroller && !hostClips && element.scrollHeight - element.clientHeight <= SLACK)
			{
				report("read");
				return;
			}
			const lineHeight = Number.parseFloat(win.getComputedStyle(element).lineHeight);
			if ((inScroller || hostClips) && !Number.isFinite(lineHeight))
			{
				onHeld(true, true);
				report("unlaid");
				return;
			}
			latch.pass();
			const cover = Math.max(0, topCover?.() ?? 0);
			const endVisible = () =>
				lineSeen(
					element,
					win,
					inScroller ? endLineHeight(element, win, lineHeight || 0) : lineHeight || 0,
					"last",
					0,
					cover,
				);
			const end = latch.seen(
				"end",
				() => element.scrollTop + element.clientHeight >= element.scrollHeight - SLACK && endVisible(),
				endVisible,
			);
			const headVisible = () =>
				lineSeen(element, win, lineHeight || 0, "first", inset(element, win, "first"), cover);
			const head =
				!hostClips || latch.seen("head", () => element.scrollTop <= SLACK && headVisible(), headVisible);
			headUnseen = !head;
			endSeen = end;
			const rect = element.getBoundingClientRect();
			const firstLineTop = rect.top + inset(element, win, "first");
			const clip = visibleClip(
				element,
				{
					box: rect,
					ownScope: approvalCardOf(element),
					topCover: cover,
				},
			);
			headPassed =
				element.scrollTop > SLACK ||
				firstLineTop < -SLACK ||
				(clip !== null && clip.top > firstLineTop + SLACK);
			const cardClip = visibleClip(
				approvalCardOf(element) ?? element,
				{
					topCover: cover,
				},
			);
			cardOnScreen =
				cardClip === null || Math.min(cardClip.bottom, win.innerHeight) - Math.max(0, cardClip.top) > SLACK;
			report(end && head ? (latch.waiting() ? "waiting" : "read") : "unread");
		};
		let settled = false;
		let settleFrame: number | undefined;
		const watch = watchReadGate(element, win, [], check, (state) =>
		{
			if (state === "unlaid" || ((inScroller || hostClips) && state === "waiting")) return;
			const held = state !== "read";
			const upward =
				hostClips &&
				(inScroller
					? headUnseen && endSeen
					: headUnseen || element.scrollHeight - element.clientHeight <= SLACK);
			const quiet = held && upward && !settled;
			if (quiet && cardOnScreen && headPassed && settleFrame === undefined)
			{
				settleFrame = win.requestAnimationFrame(() =>
				{
					settleFrame = win.requestAnimationFrame(() =>
					{
						queueMicrotask(() =>
						{
							settled = true;
							rerun?.();
						});
					});
				});
			}
			onHeld(held, quiet, upward);
		});
		kick.current = () =>
		{
			latch.forget();
			watch.kick();
		};
		return () =>
		{
			kick.current = null;
			rerun = null;
			if (settleFrame !== undefined) win.cancelAnimationFrame(settleFrame);
			latch.forget();
			watch.stop();
		};
	}, [ref, watched, text, inScroller, hostClips, topCover, onHeld, kick]);
}
