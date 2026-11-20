/**
 * Upstream's "follow latest" press/key release and still-click re-pin (cbb2d9547 `S8`, `O7`, `QDe`, `$De`, `k7`,
 * `_9`, and the `ske` feed hold props in shared-31's `pL`).
 */

/** Upstream `S8`: controls that open a pane or navigate instead of expanding in place keep the pin. */
const TRANSCRIPT_KEEPS_PIN_SELECTOR = "[data-transcript-keeps-pin],[data-transcript-step-navigates]";

/** The feed engine's own keeps: parts that continue the last turn, or are not rows at all. */
const TRANSCRIPT_NOT_ROWS_SELECTOR = "[data-transcript-continues-turn],[data-transcript-not-rows]";

/** Upstream `qM`: Enter/Space typed into these edits text rather than acting on the transcript. */
const FOLLOW_EDITABLE_SELECTOR =
	'input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';

/** Upstream `_9`'s narrower editable test for presses forwarded from rows carried outside the feed. */
const FORWARDED_EDITABLE_SELECTOR = 'input,textarea,[contenteditable="true"]';

/** Upstream `$De`. */
export const FOLLOW_REPIN_DELAY_MS = 500;

/** Upstream `QDe`: a press on one of these acts, so it never re-pins. */
const FOLLOW_REPIN_INTERACTIVE_SELECTOR =
	'a[href],button,summary,label,input,select,textarea,iframe,video,audio,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="switch"],[role="radio"],[data-cds-open-text],[data-transcript-click-acts]';

/** Upstream `Kwe`: in a secondary transcript, a press on one of these acts, so it releases follow. */
const SECONDARY_PRESS_INTERACTIVE_SELECTOR =
	'a[href],button,summary,label,input,select,textarea,iframe,video,audio,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="switch"],[role="radio"],[data-cds-open-text],[data-unmodified-lines],[data-transcript-click-acts]';

const CARD_PANEL_SELECTOR = "[data-card-panel]";

function within(target: EventTarget | null, selector: string): boolean
{
	return target instanceof Element && target.closest(selector) !== null;
}

function isActivationKey(key: string): boolean
{
	return key === "Enter" || key === " ";
}

/** Upstream `S8`. */
function keepsPin(target: EventTarget | null): boolean
{
	return within(target, TRANSCRIPT_KEEPS_PIN_SELECTOR);
}

function feedKeeps(target: EventTarget | null): boolean
{
	return keepsPin(target) || within(target, TRANSCRIPT_NOT_ROWS_SELECTOR);
}

/** The feed's pointerdown rule: release unless a keep target, or the press lands below the bottom overlay's top (`O7`). */
export function pressReleasesPin(
	event:
	{
		target: EventTarget | null;
		clientY?: number;
	},
	overlayTop = Number.POSITIVE_INFINITY,
): boolean
{
	if (feedKeeps(event.target)) return false;
	return !(event.clientY !== undefined && event.clientY > overlayTop);
}

/**
 * Upstream `jwe`: a secondary transcript (the subagent pane) keeps following on a press on plain text or a card panel,
 * and releases only when the nearest acting element below the feed is an interactive control.
 */
export function secondaryPressKeepsFollow(event: {
	target: EventTarget | null;
	currentTarget: EventTarget | null;
	composedPath(): EventTarget[];
}): boolean
{
	if (keepsPin(event.target)) return true;
	for (const node of event.composedPath())
	{
		if (node === event.currentTarget) break;
		if (!(node instanceof Element)) continue;
		if (node.matches(CARD_PANEL_SELECTOR)) return true;
		if (node.matches(SECONDARY_PRESS_INTERACTIVE_SELECTOR)) return false;
	}
	return true;
}

/** The feed's keydown rule: only Enter/Space, never in an editable field or on a keep target. */
export function keyReleasesPin(event: {key: string; target: EventTarget | null}): boolean
{
	return isActivationKey(event.key) && !within(event.target, FOLLOW_EDITABLE_SELECTOR) && !feedKeeps(event.target);
}

/** Upstream `_9`: a press or key from a row carried outside the feed (the turn-mark outlet). */
export function pressOrKeyReleasesPin(event: Event): boolean
{
	if (keepsPin(event.target)) return false;
	if (event.type === "pointerdown") return true;
	return (
		event instanceof KeyboardEvent &&
		isActivationKey(event.key) &&
		!within(event.target, FORWARDED_EDITABLE_SELECTOR)
	);
}

/**
 * Upstream `k7`: a still primary click on plain transcript text re-pins after 500ms, unless the scroll moved, a
 * selection was made, the click landed elsewhere, or another press in the scroller came first. Call it before
 * releasing the pin. Returns the abort for a pending re-pin.
 */
export function armStillClickRepin(
	event: Pick<PointerEvent, "button" | "target" | "composedPath">,
	{
		isPinned,
		scroller,
		scrollTop,
		repin,
	}:
	{
		isPinned: () => boolean;
		scroller: Element;
		scrollTop: () => number;
		repin: () => void;
	},
): (() => void) | undefined
{
	const target = event.target;
	if (
		event.button !== 0 ||
		!isPinned() ||
		within(target, FOLLOW_REPIN_INTERACTIVE_SELECTOR) ||
		event.composedPath()[0] !== target
	)
		return undefined;
	const recorded = scrollTop();
	const controller = new AbortController();
	const {signal} = controller;
	const abort = () =>
	{
		controller.abort();
	};
	window.addEventListener(
		"click",
		(click) =>
		{
			if (click.target !== target)
			{
				abort();
				return;
			}
			const timer = setTimeout(() =>
			{
				abort();
				if (scroller.isConnected && scrollTop() === recorded && getSelection()?.isCollapsed !== false) repin();
			}, FOLLOW_REPIN_DELAY_MS);
			signal.addEventListener("abort", () =>
			{
				clearTimeout(timer);
			});
		},
		{
			capture: true,
			once: true,
			signal,
		},
	);
	window.addEventListener(
		"pointerdown",
		(press) =>
		{
			if (press.composedPath().includes(scroller)) abort();
		},
		{
			capture: true,
			signal,
		},
	);
	return abort;
}
