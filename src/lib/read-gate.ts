/**
 * Upstream's approval read-gate measuring core (claude.ai/code chunk c623a1c74, plus shared-0 `xp8`): line-box
 * probes that clip through every scrolling ancestor, the padding/border inset walk, the two-frame stability latch
 * and the observer driver. Pure DOM helpers; `hooks/use-read-gate.ts` builds the plan/title gate on them.
 */

/** Upstream's slack: a line box may sit 2px outside the visible box and still count as seen. */
const SLACK = 2;
/** Upstream `h`: a reflow of more than 1px between the latch's two frames drops a pending hit. */
const STABLE = 1;
/** Upstream `s`: IntersectionObserver thresholds at every 0.1%. */
const THRESHOLDS = Array.from({length: 1001}, (_, index) => index / 1000);

/** Upstream `u`: an element in the card whose first and last line every gate must also see. */
const APPROVAL_READ_LINE_ATTR = "data-approval-read-line";
/** Upstream `T`: the rows gate wrapper's attribute, which the conversation cap's read-rows floor queries. */
export const APPROVAL_READ_ROWS_ATTR = "data-approval-read-rows";
/** Upstream `tj`: the transcript region, whose inline style changes re-run a gate. */
const TRANSCRIPT_REGION_ATTR = "data-epitaxy-transcript-region";
/**
 * Upstream `d` is `.epitaxy-approval-card`, the card root; local's card root carries `data-approval-card-root`
 * (upstream uses that attribute as the clip probe's own scope, and both name the same element).
 */
const APPROVAL_CARD = "[data-approval-card-root]";

export type ReadEdge = "first" | "last";
export type ReadGateState = "unlaid" | "unread" | "waiting" | "read";

interface Box {
	top: number;
	bottom: number;
	left: number;
	right: number;
	width: number;
	height: number;
}

export interface Clip {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

/** Upstream `xH`/`_t`: the element's window. */
export function windowOf(element: Element | null): GateWindow | null {
	return element?.ownerDocument.defaultView ?? null;
}

/** Upstream `ve`: a CSS length in px, 0 for `auto` or anything unparsable. */
function px(value: string): number {
	return Number.parseFloat(value) || 0;
}

/**
 * Upstream shared-0 `xp8`: the part of `box` (default: the element's rect) left visible after every ancestor up to
 * `body` whose overflow is not `visible`. Ancestors outside `ownScope` also lose their `scroll-padding-top/bottom`,
 * and the first `auto`/`scroll` one outside it loses `topCover` from its top. Null for an empty box.
 */
export function visibleClip(
	element: Element,
	{
		box = element.getBoundingClientRect(),
		ownScope = null,
		topCover = 0,
	}: {box?: Box | DOMRect; ownScope?: Element | null; topCover?: number} = {},
): Clip | null {
	const win = windowOf(element);
	if (win === null || (box.width === 0 && box.height === 0)) return null;
	let {top, bottom, left, right} = box;
	let cover = topCover;
	for (
		let ancestor = element.parentElement;
		ancestor !== null && ancestor !== element.ownerDocument.body;
		ancestor = ancestor.parentElement
	) {
		const style = win.getComputedStyle(ancestor);
		const clipsY = style.overflowY !== "visible";
		const clipsX = style.overflowX !== "visible";
		if (!clipsY && !clipsX) continue;
		const rect = ancestor.getBoundingClientRect();
		if (clipsY) {
			const outside = ownScope === null || !ownScope.contains(ancestor);
			const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
			top = Math.max(
				top,
				rect.top + (outside ? px(style.scrollPaddingTop) : 0) + (outside && scrolls ? cover : 0),
			);
			if (outside && scrolls) cover = 0;
			bottom = Math.min(bottom, rect.bottom - (outside ? px(style.scrollPaddingBottom) : 0));
		}
		if (clipsX) {
			left = Math.max(left, rect.left);
			right = Math.min(right, rect.right);
		}
	}
	return {top, bottom, left, right};
}

/** Upstream `c`: the closest ancestor whose `overflow-y` is `auto` or `scroll`. */
export function nearestScroller(element: Element, win: Window): HTMLElement | null {
	for (let ancestor = element.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
		const {overflowY} = win.getComputedStyle(ancestor);
		if (overflowY === "auto" || overflowY === "scroll") return ancestor;
	}
	return null;
}

/**
 * Upstream `l`: whether the element's first or last line box (`lineHeight` tall; the first one starts `offset`
 * below the top) is inside the window and, within the slack, inside every clipping ancestor. A zero-height element
 * counts as seen.
 */
export function lineSeen(
	element: Element,
	win: Window,
	lineHeight: number,
	edge: ReadEdge,
	offset = 0,
	topCover = 0,
): boolean {
	const rect = element.getBoundingClientRect();
	if (rect.height === 0) return true;
	const top = edge === "first" ? rect.top + offset : rect.bottom - lineHeight;
	const box = {
		top,
		bottom: top + lineHeight,
		left: rect.left,
		right: rect.right,
		width: rect.width,
		height: lineHeight,
	};
	if (box.top < -SLACK || box.bottom > win.innerHeight + SLACK) return false;
	const clip = visibleClip(element, {box, ownScope: element.closest(APPROVAL_CARD), topCover});
	return clip === null || (clip.top <= box.top + SLACK && clip.bottom >= box.bottom - SLACK);
}

/** Upstream `f`: the card's read-lines. */
function readLines(element: Element): Element[] {
	return Array.from(element.closest(APPROVAL_CARD)?.querySelectorAll(`[${APPROVAL_READ_LINE_ATTR}]`) ?? []);
}

/** Upstream `p`: the read-lines' joined text, so a gate notices when they change. */
function readLinesText(element: Element): string {
	return readLines(element)
		.map((line) => line.textContent)
		.join("\n");
}

export type LatchSeen = (key: string, now: () => boolean, verify?: () => boolean) => boolean;

/** Upstream `m`: whether the first and the last line of every read-line has been seen. */
export function readLinesSeen(lines: Element[], win: Window, seen: LatchSeen, laid = true, topCover = 0): boolean {
	return lines
		.flatMap((line) =>
			(["first", "last"] as const).map((edge) =>
				seen(
					`${edge}\n${line.textContent}`,
					() =>
						laid &&
						lineSeen(
							line,
							win,
							Number.parseFloat(win.getComputedStyle(line).lineHeight) || 0,
							edge,
							0,
							topCover,
						),
				),
			),
		)
		.every(Boolean);
}

export interface ReadLatch {
	/** Starts a measuring pass: drops pending hits the last pass did not ask for, and any after a reflow. */
	pass: () => void;
	/** Whether `key` is seen: confirmed, pending, or seen now (which starts a two-frame verification). */
	seen: LatchSeen;
	/** A hit is pending verification. */
	waiting: () => boolean;
	forget: () => void;
}

type FrameWindow = Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;

interface Pending {
	now: () => boolean;
	atFirstFrame?: boolean;
}

/**
 * Upstream `g`: a two-frame stability latch. A sighting stays pending until two frames later, when `recheck` runs
 * a pass in which `verify` must still hold; if the element's width or content height moved by more than 1px in
 * between, the hit is dropped, so a reflow can't fake a read. Confirmed keys stay seen until `forget()`.
 */
export function createReadLatch(element: HTMLElement, win: FrameWindow, recheck: () => void): ReadLatch {
	const confirmed = new Set<string>();
	const pending = new Map<string, Pending>();
	let asked = new Set<string>();
	const unmeasured = {width: Number.NaN, tall: Number.NaN};
	let baseline = unmeasured;
	let current = unmeasured;
	let rechecking = false;
	let frame: number | undefined;
	const moved = (size: {width: number; tall: number}) =>
		Math.abs(element.clientWidth - size.width) > STABLE || Math.abs(element.scrollHeight - size.tall) > STABLE;
	const cancel = () => {
		if (frame !== undefined) {
			win.cancelAnimationFrame(frame);
			frame = undefined;
		}
	};
	const schedule = () => {
		cancel();
		const base = baseline;
		const second = () => {
			frame = undefined;
			const changed = moved(base);
			if (!changed && !(base.width > STABLE)) return;
			rechecking = !changed;
			try {
				recheck();
			} finally {
				rechecking = false;
			}
		};
		frame = win.requestAnimationFrame(() => {
			try {
				for (const hit of pending.values()) {
					hit.atFirstFrame ??= element.clientHeight !== 0 && hit.now();
				}
			} finally {
				frame = win.requestAnimationFrame(second);
			}
		});
	};
	return {
		pass: () => {
			for (const key of pending.keys()) if (!asked.has(key)) pending.delete(key);
			asked = new Set();
			current = {width: element.clientWidth, tall: element.scrollHeight};
			if (pending.size > 0 && moved(baseline)) {
				pending.clear();
				cancel();
			}
			if (pending.size > 0 && frame === undefined && !rechecking) schedule();
		},
		seen: (key, now, verify = now) => {
			asked.add(key);
			if (confirmed.has(key)) return true;
			const hit = pending.get(key);
			if (hit !== undefined) {
				hit.now = now;
				if (!rechecking) return true;
				pending.delete(key);
				if (hit.atFirstFrame === true && verify()) {
					confirmed.add(key);
					return true;
				}
			}
			if (!now()) return false;
			if (pending.size === 0) baseline = current;
			pending.set(key, {now});
			schedule();
			return true;
		},
		waiting: () => pending.size > 0,
		forget: () => {
			confirmed.clear();
			pending.clear();
			cancel();
		},
	};
}

export interface ReadGateWatch {
	stop: () => void;
	/** Re-observes every watched element, so the ResizeObserver reports afresh. */
	kick: () => void;
}

/** A window with its own observer constructors, as `window` and a document's `defaultView` are typed. */
export type GateWindow = Window & typeof globalThis;

/** An observer constructor the types promise but jsdom (or an older engine) may lack. */
function maybe<T>(value: T): T | undefined {
	return value;
}

/**
 * Upstream `_`: runs `check` on any document scroll, window resize, intersection change, resize of the element,
 * `extra` or a read-line, font load, and inline style change of the transcript region. It detaches the scroll,
 * resize, intersection and style listeners once `check` reports `read` and re-attaches them on `unread`; the
 * ResizeObserver and the card's read-line MutationObserver stay until `stop()`.
 */
export function watchReadGate(
	element: HTMLElement,
	win: GateWindow,
	extra: (Element | null)[],
	check: (report: (state: ReadGateState) => void) => void,
	report: (state: ReadGateState) => void,
): ReadGateWatch {
	const doc = element.ownerDocument;
	const targets = () => [element, ...extra, ...readLines(element)];
	let live = true;
	let attached = false;
	const Intersection = maybe(win.IntersectionObserver);
	const intersection = Intersection === undefined ? undefined : new Intersection(run, {threshold: THRESHOLDS});
	const styleObserver = new win.MutationObserver(run);
	let region: Element | null = null;
	const watchRegion = () => {
		if (!attached || region !== null) return;
		region = element.closest(`[${TRANSCRIPT_REGION_ATTR}]`);
		if (region !== null) styleObserver.observe(region, {attributes: true, attributeFilter: ["style"]});
	};
	const detach = () => {
		if (!attached) return;
		attached = false;
		doc.removeEventListener("scroll", run, true);
		win.removeEventListener("resize", run);
		intersection?.disconnect();
		styleObserver.disconnect();
		region = null;
	};
	const attach = () => {
		if (attached) return;
		attached = true;
		doc.addEventListener("scroll", run, {capture: true, passive: true});
		win.addEventListener("resize", run, {passive: true});
		for (const target of targets()) if (target !== null) intersection?.observe(target);
		watchRegion();
	};
	const onState = (state: ReadGateState) => {
		report(state);
		if (state === "read") detach();
		else if (state === "unread") attach();
	};
	function run() {
		if (!live) return;
		watchRegion();
		check(onState);
	}
	attach();
	run();
	void fontsOf(doc)?.ready.then(run);
	const Resize = maybe(win.ResizeObserver) ?? maybe(globalThis.ResizeObserver);
	const resize = Resize === undefined ? undefined : new Resize(run);
	for (const target of targets()) if (target !== null) resize?.observe(target);
	let linesText = readLinesText(element);
	const linesObserver = new win.MutationObserver(() => {
		const next = readLinesText(element);
		if (next === linesText) return;
		linesText = next;
		for (const line of readLines(element)) {
			resize?.observe(line);
			if (attached) intersection?.observe(line);
		}
		run();
	});
	const card = element.closest(APPROVAL_CARD);
	if (card !== null) linesObserver.observe(card, {childList: true, subtree: true, characterData: true});
	return {
		stop: () => {
			live = false;
			detach();
			resize?.disconnect();
			linesObserver.disconnect();
		},
		kick: () => {
			for (const target of targets()) {
				if (target === null) continue;
				resize?.unobserve(target);
				resize?.observe(target);
			}
		},
	};
}

/** The document's font set; jsdom has none. */
function fontsOf(doc: Document): FontFaceSet | undefined {
	const fonts: FontFaceSet | undefined = doc.fonts;
	return fonts;
}

/** Upstream `S`. */
function isElement(node: Node): node is Element {
	return node.nodeType === Node.ELEMENT_NODE;
}

/**
 * Upstream `C`: the first (or last) in-flow child element, skipping `display:none` and absolutely or fixed
 * positioned ones; null when a non-blank text node comes first.
 */
function edgeChild(element: Element, win: Window, edge: ReadEdge): Element | null {
	for (
		let node = edge === "first" ? element.firstChild : element.lastChild;
		node !== null;
		node = edge === "first" ? node.nextSibling : node.previousSibling
	) {
		if (node.nodeType === Node.TEXT_NODE) {
			if (node.textContent?.trim()) return null;
		} else if (isElement(node)) {
			const {display, position} = win.getComputedStyle(node);
			if (display !== "none" && position !== "absolute" && position !== "fixed") return node;
		}
	}
	return null;
}

/**
 * Upstream `x`: the distance from the element's top (or bottom) edge to its first (or last) line of text: the
 * padding plus border of the element and of each first (or last) in-flow descendant, descending through block,
 * flow-root, list-item, contents and column-flex boxes, and stopping at a nested scroller not scrolled to its end.
 */
export function inset(element: Element, win: Window, edge: ReadEdge): number {
	let total = 0;
	let node: Element | null = element;
	while (node !== null) {
		const style = win.getComputedStyle(node);
		if (
			node !== element &&
			(style.overflowY === "auto" || style.overflowY === "scroll") &&
			node.scrollTop + node.clientHeight < node.scrollHeight - SLACK
		) {
			break;
		}
		if (style.display !== "inline" && style.display !== "contents") {
			total +=
				px(edge === "first" ? style.paddingTop : style.paddingBottom) +
				px(edge === "first" ? style.borderTopWidth : style.borderBottomWidth);
		}
		node =
			style.display === "block" ||
			style.display === "flow-root" ||
			style.display === "list-item" ||
			style.display === "contents" ||
			(style.display === "flex" && style.flexDirection === "column")
				? edgeChild(node, win, edge)
				: null;
	}
	return total;
}

/**
 * Upstream `b`: the end line box's height, one line plus the bottom inset, clamped to the element's visible height
 * so a very tall bottom padding can't make the end unreadable.
 */
export function endLineHeight(element: Element, win: Window, lineHeight: number): number {
	const height = lineHeight + inset(element, win, "last");
	if (height === lineHeight) return height;
	const {left, right, width} = element.getBoundingClientRect();
	const clip = visibleClip(element, {
		box: {top: 0, bottom: win.innerHeight, left, right, width, height: win.innerHeight},
		ownScope: element.closest(APPROVAL_CARD),
	});
	return clip === null ? height : Math.max(lineHeight, Math.min(height, clip.bottom - clip.top));
}

/** Upstream `w`: the scroller shows all of its content, within the slack (no scroller fits). */
export function fits(scroller: Element | null): boolean {
	return scroller === null || scroller.scrollHeight <= scroller.clientHeight + SLACK;
}

/** The card root (upstream `.epitaxy-approval-card`), for the hook's on-screen check. */
export function approvalCardOf(element: Element): Element | null {
	return element.closest(APPROVAL_CARD);
}
