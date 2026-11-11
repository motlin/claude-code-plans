import type {DiffSide} from "./diff-comments";

/*
 * claude.ai/code's diff scroll-to-line loop: c44d00c7f `dc`…`Ac` (single-file card path), ported line for line. Each
 * animation frame looks for the anchor's row in the file's `diffs-container` shadow root. Once found it centres the
 * row and holds it while layout settles. Until then it estimates the scroll from the first rendered row (pierre
 * virtualizes rows), halving the step whenever it overshoots.
 */

export const DIFF_SCROLL_MAX_TRIES = 60;
export const DIFF_SCROLL_HOLD_MS = 500;
export const DIFF_SCROLL_MAX_MS = 3000;
export const DIFF_SCROLL_RECENTRE_PX = 2;
export const DIFF_SCROLL_CANCEL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
const HOST_SELECTOR = "diffs-container";

export interface DiffLineAnchor {
	side: DiffSide;
	line: number;
}

export interface ScrollToLineState {
	tries: number;
	damp: number;
	lastDelta: number | null;
	cancelled: boolean;
	landedAt: number | null;
	movedAt: number;
	held: {scrollTop: number; rowTop: number} | null;
}

/** Upstream `_c`. */
export function initialScrollState(): ScrollToLineState {
	return {tries: 0, damp: 1, lastDelta: null, cancelled: false, landedAt: null, movedAt: 0, held: null};
}

/** Upstream `vc`: the nearest ancestor that scrolls vertically. */
export function scrollParentOf(element: Element): HTMLElement | null {
	for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
		if (parent.scrollHeight > parent.clientHeight) {
			const {overflowY} = getComputedStyle(parent);
			if (overflowY === "auto" || overflowY === "scroll") return parent;
		}
	}
	return null;
}

/** Upstream c91a5e4a6 `I` (imported as `Jn`): which side a code row belongs to. */
function rowSideOf(row: Element): DiffSide {
	return row.getAttribute("data-line-type") === "change-deletion" || row.closest("[data-deletions]") !== null
		? "deletions"
		: "additions";
}

/** Upstream `xc` + `Sc`: the anchor's row on its side, the other side's row that shows it, or any row with that number. */
export function findAnchorRow(root: ParentNode, anchor: DiffLineAnchor): Element | null {
	for (const row of root.querySelectorAll(`[data-line="${anchor.line}"]`)) {
		if (rowSideOf(row) === anchor.side) return row;
	}
	for (const row of root.querySelectorAll(`[data-alt-line="${anchor.line}"]`)) {
		if (rowSideOf(row) !== anchor.side) return row;
	}
	return root.querySelector(`[data-line="${anchor.line}"]`);
}

/** Upstream `Cc`: the first rendered row on the side, else the first rendered row. */
export function firstRenderedRow(root: ParentNode, side: DiffSide): Element | null {
	let first: Element | null = null;
	for (const row of root.querySelectorAll("[data-line]")) {
		if (rowSideOf(row) === side) return row;
		first ??= row;
	}
	return first;
}

/** Upstream `wc`. */
function scrollFileTop(element: Element): true {
	element.scrollIntoView({behavior: "instant", block: "start"});
	return true;
}

/** Upstream `Tc`: how far the row's centre sits from the scroller's client centre. */
function offCentre(row: Element, scroller: HTMLElement): number {
	const box = row.getBoundingClientRect();
	const frame = scroller.getBoundingClientRect();
	return box.top + box.height / 2 - (frame.top + scroller.clientTop + scroller.clientHeight / 2);
}

/** Upstream `Ec`: the row's top in the scroller's content coordinates. */
function contentTop(row: Element, scroller: HTMLElement): number {
	return (
		row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop
	);
}

/** Upstream `Dc`. */
function moved(from: number, to: number): boolean {
	return Math.abs(to - from) >= 1;
}

/** Upstream `Oc`: centre the found row, recentre while layout settles, and stop once it holds still. */
function holdRow(row: Element, scroller: HTMLElement, state: ScrollToLineState, now: number): boolean {
	const {held} = state;
	if (held !== null && moved(held.scrollTop, scroller.scrollTop) && !moved(held.rowTop, contentTop(row, scroller))) {
		return true;
	}
	state.tries = 0;
	state.damp = 1;
	state.lastDelta = null;
	if (state.landedAt === null) {
		state.landedAt = now;
		state.movedAt = now;
		row.scrollIntoView({behavior: "instant", block: "center"});
	} else if (Math.abs(offCentre(row, scroller)) >= DIFF_SCROLL_RECENTRE_PX) {
		const before = scroller.scrollTop;
		row.scrollIntoView({behavior: "instant", block: "center"});
		if (moved(before, scroller.scrollTop)) state.movedAt = now;
	}
	state.held = {scrollTop: scroller.scrollTop, rowTop: contentTop(row, scroller)};
	return now - state.movedAt >= DIFF_SCROLL_HOLD_MS || now - state.landedAt >= DIFF_SCROLL_MAX_MS;
}

/** Upstream `kc`: one frame of the loop; true when it is done. `lineHeight` is the code row height in px. */
export function stepScrollToLine(
	fileElement: Element,
	anchor: DiffLineAnchor,
	state: ScrollToLineState,
	lineHeight: number,
	now: number = performance.now(),
): boolean {
	if (state.cancelled || !Number.isFinite(anchor.line)) return true;
	const host = fileElement.querySelector(HOST_SELECTOR);
	const scroller = scrollParentOf(fileElement);
	const root = host === null ? null : (host.shadowRoot ?? host);
	const row = root !== null && scroller !== null ? findAnchorRow(root, anchor) : null;
	if (row !== null && scroller !== null) return holdRow(row, scroller, state, now);
	state.movedAt = now;
	state.held = null;
	state.tries += 1;
	if (state.tries > DIFF_SCROLL_MAX_TRIES) return state.landedAt !== null || scrollFileTop(fileElement);
	if (root === null || scroller === null) return false;
	const first = firstRenderedRow(root, anchor.side);
	const firstLine = first === null ? Number.NaN : Number.parseInt(first.getAttribute("data-line") ?? "", 10);
	const scrollTop = scroller.scrollTop;
	if (Number.isFinite(firstLine)) {
		let delta = (anchor.line - firstLine) * lineHeight;
		if (state.lastDelta !== null && Math.sign(delta) !== Math.sign(state.lastDelta)) {
			state.damp = Math.max(state.damp / 2, 0.1);
		}
		state.lastDelta = delta;
		delta *= state.damp;
		scroller.scrollTop = Math.max(0, scrollTop + delta);
		return scroller.scrollTop === scrollTop && state.landedAt === null && scrollFileTop(fileElement);
	}
	const box = fileElement.getBoundingClientRect();
	const fileTop = box.top - scroller.getBoundingClientRect().top + scrollTop;
	const into = Math.min(anchor.line * lineHeight, Math.max(0, box.height - scroller.clientHeight / 2));
	scroller.scrollTop = Math.max(0, fileTop + into - scroller.clientHeight / 2);
	return false;
}

/** Upstream `Ac`: runs the loop a frame at a time until done; input inside the scroller cancels it. Returns a cancel. */
export function startScrollToLine(fileElement: Element, anchor: DiffLineAnchor, lineHeight: number): () => void {
	const state = initialScrollState();
	const document = fileElement.ownerDocument;
	const view = document.defaultView ?? window;
	let frame = 0;
	function cancel() {
		state.cancelled = true;
		view.cancelAnimationFrame(frame);
		for (const type of DIFF_SCROLL_CANCEL_EVENTS) document.removeEventListener(type, onInput, true);
	}
	function onInput(event: Event) {
		const target = event.target instanceof Node ? event.target : null;
		if (scrollParentOf(fileElement)?.contains(target) === true) cancel();
	}
	const tick = () => {
		if (!fileElement.isConnected || stepScrollToLine(fileElement, anchor, state, lineHeight)) {
			cancel();
			return;
		}
		frame = view.requestAnimationFrame(tick);
	};
	for (const type of DIFF_SCROLL_CANCEL_EVENTS) {
		document.addEventListener(type, onInput, {capture: true, passive: true});
	}
	tick();
	return cancel;
}
