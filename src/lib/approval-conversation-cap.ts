/**
 * Upstream's approval conversation cap fitter (claude.ai/code chunk c2d1aeb56 `z`, decoded in
 * `.llm/upstream-sync/dumps/approval-conversation-cap-fit-decode-2026-11-10.txt`): an in-flow tool card at the end
 * of the conversation caps its height to what the transcript scroller can show, never below its chrome plus a body
 * floor, and pulls up the tail space under it. Pure DOM; `hooks/use-approval-conversation-cap.ts` drives it.
 */
import {APPROVAL_READ_ROWS_ATTR, inset} from "./read-gate";

/** Upstream `E`: the card's height cap, read by the in-flow tool card root's max-height. */
export const APPROVAL_CAP_VAR = "--approval-conversation-cap";
/** Upstream `D`: the tail space the card reclaims, read by the in-flow tool card root's negative bottom margin. */
export const APPROVAL_RECLAIM_VAR = "--approval-conversation-end-reclaim";
/** Upstream `O`: the gap the reclaim leaves under the card. */
const GAP = 8;
/** Upstream `k`: the most tail space the card reclaims. */
const RECLAIM_CAP = 40;
/** Upstream `A`: the body never caps below this. */
const BODY_FLOOR = 34;
/** Upstream `j` (`.epitaxy-approval-body`), the local body attribute. */
export const APPROVAL_BODY_SELECTOR = "[data-approval-card-body]";

/** Upstream `M`. */
export function capValue(room: number, floor: number): string
{
	return `max(min(60vh, ${room}px), ${floor}px)`;
}

/** Upstream shared-0 `ve`: a CSS length in px, 0 for `auto`, empty or anything unparsable. */
function px(value: string): number
{
	return Number.parseFloat(value) || 0;
}

/** Upstream `N`: the card's flow box, the outermost `display: contents` wrapper around it. */
function flowBox(card: Element, win: Window): Element
{
	let flow = card;
	for (
		let parent = card.parentElement;
		parent !== null && win.getComputedStyle(parent).display === "contents";
		parent = parent.parentElement
	)
	{
		flow = parent;
	}
	return flow;
}

/** Upstream `P`: whether the element shows below `after` (the card's content end). */
function visible(element: Element, after: number, win: Window): boolean
{
	if (element.getAttribute("aria-hidden") !== null && element.childElementCount === 0) return false;
	const style = win.getComputedStyle(element);
	if (style.display === "contents") return [...element.children].some((child) => visible(child, after, win));
	if (style.position === "absolute" || style.position === "fixed") return false;
	const box = element.getBoundingClientRect();
	return box.height > 0 && box.top >= after - 1;
}

/**
 * Upstream `F`: nothing visible follows `start` at any level up to the scroller (also before it, at a level whose
 * CSS `order` moves it).
 */
function lastVisible(start: Element, scroller: Element, after: number, win: Window): boolean
{
	for (let node = start; node !== scroller && node.parentElement !== null; node = node.parentElement)
	{
		for (let next = node.nextElementSibling; next !== null; next = next.nextElementSibling)
		{
			if (visible(next, after, win)) return false;
		}
		if ((Number.parseFloat(win.getComputedStyle(node).order) || 0) !== 0)
		{
			for (
				let previous = node.previousElementSibling;
				previous !== null;
				previous = previous.previousElementSibling
			)
			{
				if (visible(previous, after, win)) return false;
			}
		}
	}
	return true;
}

/** Upstream `I`: the bottom of the column's last child that is not absolute, fixed or sticky. */
function flowEnd(column: Element, win: Window): number | undefined
{
	for (let child = column.lastElementChild; child !== null; child = child.previousElementSibling)
	{
		const {position} = win.getComputedStyle(child);
		if (!["absolute", "fixed", "sticky"].includes(position)) return child.getBoundingClientRect().bottom;
	}
	return undefined;
}

/**
 * Upstream `L`: the body height that still shows a read-gated rows panel's head line and first row, or its last
 * line, plus 2px. 0 without a rows panel.
 */
function readRowsFloor(body: Element | null, win: Window): number
{
	const rows = body?.querySelector(`[${APPROVAL_READ_ROWS_ATTR}]`);
	if (!body || !rows) return 0;
	const lineHeight = Number.parseFloat(win.getComputedStyle(rows).lineHeight);
	const padTop = inset(rows, win, "first");
	const padBottom = inset(rows, win, "last");
	const bodyBox = body.getBoundingClientRect();
	const rowsBox = rows.getBoundingClientRect();
	const above = rowsBox.top - bodyBox.top + body.scrollTop;
	const below = Math.max(0, body.scrollHeight - (rowsBox.bottom - bodyBox.top + body.scrollTop));
	const row = rows.querySelector("li");
	const rowGap =
		row === null
			? 0
			: Math.min(lineHeight, Math.max(0, row.getBoundingClientRect().top - rowsBox.top - padTop - lineHeight));
	const head = above + padTop + lineHeight + (row === null ? 0 : rowGap + lineHeight);
	const tail = below + padBottom + lineHeight;
	const whole = rowsBox.height - padTop + below;
	return Math.max(tail, Math.min(head, whole)) + 2;
}

export interface ConversationCapFitter
{
	/** The scroller's direct child that holds the card, which the driver also observes. */
	column: Element;
	measure: () => void;
}

/**
 * Upstream `z`'s measure: writes or removes the cap and the end reclaim on `card.style`. Two clipped measures in a
 * row under a cap make it stop capping for the fitter's lifetime.
 */
export function createConversationCapFitter(
	card: HTMLElement,
	win: Window,
	scroller: HTMLElement,
): ConversationCapFitter
{
	const flow = flowBox(card, win);
	let column = flow;
	while (column.parentElement !== null && column.parentElement !== scroller) column = column.parentElement;
	let gaveUp = false;
	let wasOver = false;
	const measure = () =>
	{
		const scrollerStyle = win.getComputedStyle(scroller);
		const box = card.getBoundingClientRect();
		const reclaimNow = px(card.style.getPropertyValue(APPROVAL_RECLAIM_VAR));
		const capped = card.style.getPropertyValue(APPROVAL_CAP_VAR) !== "";
		const after = box.bottom - reclaimNow;
		const contentEnd =
			(column === flow ? undefined : flowEnd(column, win)) ??
			scroller.getBoundingClientRect().top + scroller.clientTop + scroller.scrollHeight - scroller.scrollTop;
		const spare = Math.max(0, contentEnd - after - px(scrollerStyle.scrollPaddingBottom));
		const reclaim = lastVisible(flow, scroller, after, win)
			? Math.min(RECLAIM_CAP, Math.max(0, Math.floor(spare - GAP)))
			: 0;
		const room = Math.floor(
			scroller.clientHeight -
				px(scrollerStyle.scrollPaddingTop) -
				px(scrollerStyle.scrollPaddingBottom) -
				(spare - reclaim),
		);
		const body = card.querySelector(APPROVAL_BODY_SELECTOR);
		const lastBottom = card.lastElementChild?.getBoundingClientRect().bottom ?? box.bottom;
		const chrome =
			Math.max(box.height, lastBottom + px(win.getComputedStyle(card).paddingBottom) - box.top) -
			(body?.clientHeight ?? 0);
		const bodyFloor = Math.max(
			BODY_FLOOR,
			readRowsFloor(body, win),
			body === null ? 0 : px(win.getComputedStyle(body).minHeight),
		);
		const over = capped && lastBottom > box.bottom + 1;
		if (over && wasOver) gaveUp = true;
		wasOver = over;
		const floor = Math.ceil(chrome + bodyFloor);
		const atEnd = lastVisible(flow.parentElement ?? flow, scroller, after, win);
		if (reclaim > 0) card.style.setProperty(APPROVAL_RECLAIM_VAR, `${reclaim}px`);
		else card.style.removeProperty(APPROVAL_RECLAIM_VAR);
		if (!gaveUp && room > 0 && atEnd && Number.isFinite(floor))
			card.style.setProperty(APPROVAL_CAP_VAR, capValue(room, floor));
		else card.style.removeProperty(APPROVAL_CAP_VAR);
	};
	return {
		column,
		measure,
	};
}
