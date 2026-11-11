import {createElement, useCallback, useEffect, useRef, useState, type ReactElement} from "react";

/**
 * Upstream's approval slot focus landing (ca8b34310 `h_`/`c_`/`u_`/`d_`/`l_`, shared-frame `Gt`,
 * shared-11 `ic`/`nO`): when an approval card that held keyboard focus leaves its slot, focus lands on
 * the slot's next waiting card with a focus ring, or hands back to the composer. A held or doubled Enter,
 * a digit or an arrow can't act on the landed card until a fresh pick at least 400ms later, a letter typed
 * on it goes to the composer, and a plain Enter right after the hand-back is swallowed for 500ms.
 */

/** Upstream's fresh-pick floor: a landed card takes no pick sooner than this after the landing. */
const FRESH_PICK_MS = 400;
/** Upstream's `bx`: how long a plain Enter is swallowed after the focus loss. */
const ENTER_SWALLOW_MS = 500;
/** Upstream's `N1`: a focusin this soon after the focus loss re-arms the Enter swallow. */
const FOCUSIN_REARM_MS = 1000;
/** Upstream's `n1`: no pick within this long of the window regaining focus. */
const WINDOW_REFOCUS_GUARD_MS = 1000;
/** Upstream's `f_`: a keyboard touch inside the slot this recent counts as a keyboard leave. */
const KEYBOARD_MEMORY_MS = 10_000;

/** Upstream's `yE`: the landing ring on a static-positioned card root. */
export const LANDING_RING = "focus-visible:outline-hidden focus-visible:shadow-focus";
/**
 * Upstream's `bP`: the landing ring drawn as an inset `::after` on a positioned card root. Upstream hides the
 * root's outline with `outline-none`; locally `outline-hidden`, so forced-colors mode keeps a transparent ring.
 */
export const LANDING_AFTER_RING =
	"focus-visible:outline-hidden focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-0.5 focus-visible:after:rounded-[calc(theme(--radius-card)-var(--spacing)*0.5)] focus-visible:after:shadow-focus focus-visible:after:outline-hidden focus-visible:after:-outline-offset-2";

const CARD_ROOT = "[data-approval-card-root]";
const STOP_NAME = "data-question-stop-name";
const FALLBACK_NAME = "data-fallback-name";
/** Upstream's `Oh`: an element already named, so the landing leaves its name alone. */
const ALREADY_NAMED = `[aria-labelledby], [aria-label]:not([${FALLBACK_NAME}])`;
/** Upstream's `_8`: a fallback name the landing's cleanup restores. */
const FALLBACK_NAMED = `[${FALLBACK_NAME}]:not([aria-label])`;

/** Upstream's `qo`: keys that neither clear a landing nor end the Enter swallow. */
const MODIFIERS: ReadonlySet<string> = new Set(["Alt", "Control", "Shift", "Meta"]);

/** Seams the tests replace: jsdom's dispatched events are never trusted. */
export const landingSeams = {
	isTrusted: (event: Event): boolean => event.isTrusted,
};

/** What the landing reads from the slot's current config when a key arrives. */
export interface LandingConfig {
	chordActsAnywhere: boolean;
	toComposer: (from: Element) => void;
}

interface Landing {
	/** The landed element: the card root, or the composer focus went to; null when focus stayed on the body. */
	at: Element | null;
	onCard: boolean;
	since: number;
	/** The slot's parent: where the composer hand-back comes from. */
	from: Element;
	drawn: () => LandingConfig | null;
	picked: boolean;
}

/** Upstream's `Q`: one landing per window, the latest replacing the last. */
const landings = new WeakMap<Window, Landing>();
const keysInstalled = new WeakSet<Window>();

function windowOf(node: Node): Window | null {
	return (node instanceof Document ? node : node.ownerDocument)?.defaultView ?? null;
}

function elementOf(target: EventTarget | null): Element | null {
	return target instanceof Element ? target : null;
}

/** Upstream's `pK`: nothing real holds focus. */
function focusOnBody(doc: Document): boolean {
	return doc.activeElement === null || doc.activeElement === doc.body;
}

interface WindowFocus {
	gainedAt: number;
	leftAt: number;
	pointerAt: number;
}

const windowFocus = new WeakMap<Window, WindowFocus>();

/** Upstream's window focus tracker (`Et`): when the window last gained and lost focus, and the last pointerdown. */
export function trackWindowFocus(win: Window): void {
	if (windowFocus.has(win)) return;
	const state: WindowFocus = {gainedAt: -Infinity, leftAt: -Infinity, pointerAt: -Infinity};
	windowFocus.set(win, state);
	win.addEventListener("focus", () => {
		state.gainedAt = performance.now();
		state.leftAt = -Infinity;
	});
	win.addEventListener("blur", () => {
		state.leftAt = performance.now();
	});
	win.addEventListener(
		"pointerdown",
		() => {
			state.pointerAt = performance.now();
		},
		true,
	);
}

/** Upstream's `c2`: the window has focus (never left, or a pointer came back since). */
function windowFocused(win: Window): boolean {
	const state = windowFocus.get(win);
	return state === undefined || state.leftAt === -Infinity || state.pointerAt > state.leftAt;
}

/** Upstream's `EZ`: within a second of the window regaining focus. */
function justRefocused(win: Window): boolean {
	const state = windowFocus.get(win);
	return state !== undefined && performance.now() - state.gainedAt <= WINDOW_REFOCUS_GUARD_MS;
}

export function recordLanding(
	win: Window,
	landing: {at: Element | null; onCard: boolean; from: Element; drawn: () => LandingConfig | null},
): void {
	landings.set(win, {...landing, since: performance.now(), picked: false});
}

export function clearLanding(win: Window): void {
	landings.delete(win);
}

/**
 * Forgets the window's landing and its focus, blur and pointer times, as a fresh page starts. The tests' shared jsdom
 * workers keep one window across files, where a time an earlier file stamped would read as a window that just regained
 * focus to a later file's fake clock.
 */
export function resetLandingWindow(win: Window): void {
	landings.delete(win);
	const state = windowFocus.get(win);
	if (state === undefined) return;
	state.gainedAt = -Infinity;
	state.leftAt = -Infinity;
	state.pointerAt = -Infinity;
}

/** Upstream's `l_`: focus landed on this card and is still there. */
export function landedOnCard(element: Element): boolean {
	const win = windowOf(element);
	const entry = win === null ? undefined : landings.get(win);
	return entry?.onCard === true && entry.at === element;
}

/**
 * Upstream's `u_`: a key on the landed card that counts as a fresh pick: unrepeated, with no ⌘, Ctrl or ⌥,
 * trusted, at least 400ms after the landing, and not within a second of the window regaining focus.
 */
function isFreshPick(event: KeyboardEvent): boolean {
	const target = elementOf(event.target);
	const win = target === null ? null : windowOf(target);
	const entry = win === null ? undefined : landings.get(win);
	return (
		win !== null &&
		entry?.onCard === true &&
		entry.at === event.target &&
		!event.repeat &&
		!(event.metaKey || event.ctrlKey || event.altKey) &&
		landingSeams.isTrusted(event) &&
		performance.now() - entry.since >= FRESH_PICK_MS &&
		!justRefocused(win)
	);
}

/** Upstream's `d_`: with no landing any pick goes; on a landing only a fresh pick, which `mark` records as picked. */
export function landingAllowsPick(event: KeyboardEvent, mark: boolean): boolean {
	const target = elementOf(event.target);
	const win = target === null ? null : windowOf(target);
	const entry = win === null ? undefined : landings.get(win);
	if (entry?.onCard !== true) return true;
	if (!isFreshPick(event)) return false;
	if (mark) entry.picked = true;
	return true;
}

/**
 * Upstream's `c_`: the landing's window capture listeners, installed once per window. On the landed card a
 * plain Enter waits for a fresh pick, ⇧⌘⏎ is swallowed unless the card's chord acts anywhere, and a printable
 * non-digit, non-space key hands focus to the composer so it types there. A composer landing clears on the
 * first non-repeat key; a pointerdown in (or without) the landed element, or focus leaving it, clears either.
 */
export function installLandingKeys(win: Window): void {
	if (keysInstalled.has(win)) return;
	keysInstalled.add(win);
	const clear = () => {
		landings.delete(win);
	};
	win.addEventListener(
		"keydown",
		(event) => {
			const entry = landings.get(win);
			if (entry === undefined || MODIFIERS.has(event.key)) return;
			if (entry.at !== null && win.document.activeElement !== entry.at) {
				clear();
				return;
			}
			const chord = event.metaKey || event.ctrlKey;
			if (event.key === "Enter") {
				const swallow = chord
					? event.shiftKey && entry.drawn()?.chordActsAnywhere !== true
					: entry.onCard && (!entry.picked || !isFreshPick(event));
				if (swallow) {
					event.preventDefault();
					event.stopImmediatePropagation();
				}
			} else if (entry.onCard) {
				if (event.key.length === 1 && !/[\d ]/.test(event.key) && !chord) entry.drawn()?.toComposer(entry.from);
			} else if (!event.repeat) clear();
		},
		true,
	);
	win.addEventListener(
		"pointerdown",
		(event) => {
			const at = landings.get(win)?.at;
			if (at === undefined) return;
			if (at === null || at.contains(elementOf(event.target))) clear();
		},
		true,
	);
	win.addEventListener(
		"focusout",
		(event) => {
			const at = landings.get(win)?.at;
			if (event.target === at && win.document.activeElement !== at) clear();
		},
		true,
	);
}

/**
 * Upstream's `Gt`: after focus is lost, a plain Enter is swallowed for 500ms and a repeat Enter always (re-arming
 * the 500ms). With `focusOnBody`, a focusin within a second re-arms it once. The first non-repeat, non-modifier
 * key or a window blur ends it.
 */
export function swallowEnterAfterFocusLoss(doc: Document, focusOnBodyNow = false): () => void {
	let until = performance.now() + ENTER_SWALLOW_MS;
	const startedAt = performance.now();
	const view = doc.defaultView;
	let blurred = false;
	const onKeyDown = (event: KeyboardEvent) => {
		const plain = !(event.shiftKey || event.metaKey || event.ctrlKey || event.altKey);
		if (event.key === "Enter" && (event.repeat || (plain && performance.now() < until))) {
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) until = performance.now() + ENTER_SWALLOW_MS;
		} else if (!event.repeat && !MODIFIERS.has(event.key)) stop();
	};
	const onFocusIn = () => {
		if (performance.now() - startedAt <= FOCUSIN_REARM_MS) until = performance.now() + ENTER_SWALLOW_MS;
		doc.removeEventListener("focusin", onFocusIn, true);
	};
	const onBlur = () => {
		blurred = true;
		queueMicrotask(() => {
			if (blurred) stop();
		});
	};
	const onFocus = () => {
		blurred = false;
	};
	const stop = () => {
		doc.removeEventListener("keydown", onKeyDown, true);
		doc.removeEventListener("focusin", onFocusIn, true);
		view?.removeEventListener("blur", onBlur);
		view?.removeEventListener("focus", onFocus);
	};
	doc.addEventListener("keydown", onKeyDown, true);
	if (focusOnBodyNow) doc.addEventListener("focusin", onFocusIn, true);
	view?.addEventListener("blur", onBlur);
	view?.addEventListener("focus", onFocus);
	return stop;
}

/**
 * Upstream's `o_`: the landing target in a slot, the first card root that draws a box (not `display: contents`),
 * else the slot's first child, descending past `display: contents` wrappers.
 */
function firstRealCardRoot(slot: Element): HTMLElement | null {
	const view = windowOf(slot);
	if (view === null) return null;
	const draws = (element: Element) => view.getComputedStyle(element).display !== "contents";
	let found: Element | null = [...slot.querySelectorAll(CARD_ROOT)].find(draws) ?? slot.firstElementChild;
	while (found !== null && !draws(found)) found = found.firstElementChild;
	return found instanceof HTMLElement ? found : null;
}

let namedByText = 0;

/**
 * Upstream's `nO`/`k0`: names an unnamed landed element by its `[data-question-stop-name]` parts (or by its own
 * text without any), as a group labelled by their ids. Returns the cleanup that restores what it changed.
 */
function nameFromStopParts(element: Element): () => void {
	if (element.matches(ALREADY_NAMED)) return () => undefined;
	const parts = [...element.querySelectorAll(`[${STOP_NAME}]`)].filter((part) => part.textContent.trim() !== "");
	const label = element.getAttribute("aria-label");
	const names = parts.length === 0 ? [element] : parts;
	const given = names.filter((part) => part.id === "");
	for (const part of given) {
		namedByText += 1;
		part.id = `named-by-text-${namedByText}`;
	}
	const addedRole = !element.hasAttribute("role");
	if (addedRole) element.setAttribute("role", "group");
	element.removeAttribute("aria-label");
	const labelledBy = names.map((part) => part.id).join(" ");
	element.setAttribute("aria-labelledby", labelledBy);
	return () => {
		if (element.getAttribute("aria-labelledby") === labelledBy) element.removeAttribute("aria-labelledby");
		if (label !== null && element.matches(FALLBACK_NAMED)) element.setAttribute("aria-label", label);
		if (addedRole) element.removeAttribute("role");
		for (const part of given) part.removeAttribute("id");
	};
}

/**
 * Upstream's `ic`: focuses `element` focus-visible with the landing ring classes (kept on through React
 * re-renders), a temporary `tabindex="-1"` when it has none, and a name from its parts. All of it is undone
 * when focus leaves, or at once when focus didn't land.
 */
function focusWithLandingRing(element: HTMLElement, ring: string): void {
	const unname = nameFromStopParts(element);
	const added = ring.split(" ").filter((name) => name !== "" && !element.classList.contains(name));
	const hadNoClass = !element.hasAttribute("class");
	element.classList.add(...added);
	const observer = new MutationObserver(() => {
		if (added.some((name) => !element.classList.contains(name))) element.classList.add(...added);
	});
	observer.observe(element, {attributeFilter: ["class"]});
	const addedTabIndex = !element.hasAttribute("tabindex");
	if (addedTabIndex) element.setAttribute("tabindex", "-1");
	const cleanup = () => {
		if (element.ownerDocument.activeElement === element) return;
		element.removeEventListener("blur", cleanup);
		observer.disconnect();
		if (addedTabIndex) element.removeAttribute("tabindex");
		element.classList.remove(...added);
		if (hadNoClass && element.classList.length === 0) element.removeAttribute("class");
		unname();
	};
	element.addEventListener("blur", cleanup);
	element.focus({focusVisible: true});
	cleanup();
}

/** Upstream's `Bo` (gate `__gb__1951358650`, on): a primary mouse click with no source capabilities, as assistive tech sends. */
function syntheticMouseClick(event: Event): boolean {
	return (
		event.type === "click" &&
		event instanceof MouseEvent &&
		event.button === 0 &&
		event.buttons === 1 &&
		"pointerType" in event &&
		event.pointerType === "mouse" &&
		!("sourceCapabilities" in event && event.sourceCapabilities)
	);
}

/**
 * Upstream's `_i` leave detector: focus came into the slot focus-visible (keyboard, or a synthetic click) and
 * is still inside it when the card leaves.
 */
function useFocusVisibleLeave(place: Element, onLeft: (place: Element) => void): void {
	useEffect(() => {
		const doc = place.ownerDocument;
		const view = doc.defaultView;
		let visible = false;
		let pointer = false;
		let clicked = false;
		const onFocusIn = (event: Event) => {
			try {
				visible = clicked || (!pointer && elementOf(event.target)?.matches(":focus-visible") === true);
			} catch {
				visible = false;
			}
		};
		const onPointerDown = () => {
			visible = false;
			pointer = true;
			view?.setTimeout(() => {
				pointer = false;
			}, 0);
		};
		const onKeyDown = (event: Event) => {
			if (event instanceof KeyboardEvent && !MODIFIERS.has(event.key)) visible = true;
		};
		const endClick = () => {
			clicked = false;
			doc.removeEventListener("pointerdown", endClick, true);
		};
		const onClick = (event: Event) => {
			if (!syntheticMouseClick(event) || view === null || !windowFocused(view)) return;
			visible = true;
			clicked = true;
			doc.addEventListener("pointerdown", endClick, true);
		};
		place.addEventListener("focusin", onFocusIn);
		place.addEventListener("pointerdown", onPointerDown);
		place.addEventListener("keydown", onKeyDown);
		place.addEventListener("click", onClick, true);
		return () => {
			place.removeEventListener("focusin", onFocusIn);
			place.removeEventListener("pointerdown", onPointerDown);
			place.removeEventListener("keydown", onKeyDown);
			place.removeEventListener("click", onClick, true);
			endClick();
			if (visible && place.contains(doc.activeElement)) onLeft(place);
		};
	}, [place, onLeft]);
}

/**
 * Upstream's `p_` leave detector: a keyboard focusin, key or synthetic click inside the slot within the last
 * 10s (a pointerdown resets it), and focus on the body once the card has gone.
 */
function useKeyboardMemoryLeave(place: Element, onLeft: (place: Element) => void): void {
	useEffect(() => {
		const doc = place.ownerDocument;
		const view = doc.defaultView;
		if (view === null) return undefined;
		let touchedAt = -Infinity;
		let pointer = false;
		const stamp = (event: Event, counts: boolean) => {
			touchedAt = counts && place.contains(elementOf(event.target)) ? performance.now() : -Infinity;
		};
		const onFocusIn = (event: Event) => {
			stamp(event, !pointer);
		};
		const onPointerDown = () => {
			pointer = true;
			touchedAt = -Infinity;
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (MODIFIERS.has(event.key) || event.repeat) return;
			pointer = false;
			stamp(event, true);
		};
		const onClick = (event: Event) => {
			if (!syntheticMouseClick(event) || !windowFocused(view)) return;
			pointer = false;
			stamp(event, true);
		};
		view.addEventListener("focusin", onFocusIn, true);
		view.addEventListener("pointerdown", onPointerDown, true);
		view.addEventListener("keydown", onKeyDown, true);
		view.addEventListener("click", onClick, true);
		return () => {
			view.removeEventListener("focusin", onFocusIn, true);
			view.removeEventListener("pointerdown", onPointerDown, true);
			view.removeEventListener("keydown", onKeyDown, true);
			view.removeEventListener("click", onClick, true);
			if (performance.now() - touchedAt < KEYBOARD_MEMORY_MS && focusOnBody(doc)) onLeft(place);
		};
	}, [place, onLeft]);
}

/** Upstream's `m_`: keyed by the card, so the next card unmounts the last one's detectors and they report a leave. */
function SlotWatch({place, onLeft}: {place: Element; onLeft: (place: Element) => void}): null {
	useFocusVisibleLeave(place, onLeft);
	useKeyboardMemoryLeave(place, onLeft);
	return null;
}

export interface ApprovalSlotConfig {
	/** The drawn card's key (`${kind}:${id}`), undefined while the slot draws no card. */
	card: string | undefined;
	/** Whether the drawn card takes focus when an earlier card leaves (not a deny-first card). */
	takesFocus: boolean;
	/** True while the composer holds a draft: focus then goes back to it, not to the next card. */
	hasDraft: () => boolean;
	/** Upstream's plan / app-list cards: ⇧⌘⏎ still acts after a landing. */
	chordActsAnywhere: boolean;
	/** A transcript row the card is drawn into, watched in the slot's place. */
	row?: Element | null;
	/** Hands focus back to the composer. */
	toComposer: (from: Element) => void;
}

interface LiveSlot extends LandingConfig {
	landing: Element | null;
	hasDraft: () => boolean;
}

/**
 * Upstream's `h_`: `setSlot` is the ref for the slot wrapper and `watch` an element to render beside it. When a
 * card that held keyboard focus leaves, in a microtask and only while focus sits on the body, focus lands on the
 * slot's next card that takes focus (with no composer draft and the window focused), else the composer; the
 * landing is recorded for the window keys, and a plain Enter is swallowed for 500ms.
 */
export function useApprovalSlot({
	card,
	takesFocus,
	hasDraft,
	chordActsAnywhere,
	row = null,
	toComposer,
}: ApprovalSlotConfig): {setSlot: (slot: HTMLElement | null) => void; watch: ReactElement | null} {
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	const place = card === undefined ? null : (row ?? slot);
	const landing = takesFocus ? place : null;
	const live = useRef<LiveSlot | null>(null);
	useEffect(() => {
		if (place !== null) {
			const win = windowOf(place);
			if (win !== null) {
				trackWindowFocus(win);
				installLandingKeys(win);
			}
		}
		live.current = {landing, hasDraft, chordActsAnywhere, toComposer};
		return () => {
			live.current = null;
		};
	}, [place, landing, hasDraft, chordActsAnywhere, toComposer]);
	const onLeft = useCallback((left: Element) => {
		const from = left.parentElement;
		const win = windowOf(left);
		if (win !== null) clearLanding(win);
		queueMicrotask(() => {
			const config = live.current;
			const doc = from?.ownerDocument;
			const view = doc?.defaultView ?? null;
			if (from === null || doc === undefined || view === null || config === null || !focusOnBody(doc)) return;
			if (config.landing !== null && !config.hasDraft() && windowFocused(view)) {
				const target = firstRealCardRoot(config.landing);
				if (target !== null) {
					const positioned = view.getComputedStyle(target).position !== "static";
					focusWithLandingRing(target, positioned ? LANDING_AFTER_RING : LANDING_RING);
				}
			}
			const onCard = !focusOnBody(doc);
			if (!onCard) config.toComposer(from);
			recordLanding(view, {
				at: focusOnBody(doc) ? null : doc.activeElement,
				onCard,
				from,
				drawn: () => live.current,
			});
			swallowEnterAfterFocusLoss(doc, focusOnBody(doc));
		});
	}, []);
	const watch = place === null ? null : createElement(SlotWatch, {key: card, place, onLeft});
	return {setSlot, watch};
}
