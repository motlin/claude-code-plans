import {isAvailable} from "./focus-regions";

/**
 * Upstream's `question` focus region: the palette's "Jump to question" lands
 * on the first waiting card, dock cards (beside the composer) before
 * transcript cards, and draws the cds overlay focus ring on it until the next
 * real interaction.
 */
export const WAITING_CARD_SELECTOR = "[data-approval-card-root]";

const LANDING_ATTR = "data-focus-region-landing";
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

/** The first shown waiting card: the composer dock's cards first, then the rest in document order. */
export function findWaitingCard(root: Document): HTMLElement | null {
	const all = [...root.querySelectorAll<HTMLElement>(WAITING_CARD_SELECTOR)].filter(isAvailable);
	const dock = root.querySelector('[data-focus-region="composer"]')?.parentElement ?? null;
	const docked = dock === null ? undefined : all.find((card) => dock.contains(card));
	return docked ?? all[0] ?? null;
}

/** Focus the card with the overlay landing ring, cleared by the next key, input, pointerdown, focus-out or window blur. */
export function landOnWaitingCard(card: HTMLElement): void {
	if (!card.hasAttribute("tabindex")) card.tabIndex = -1;
	card.scrollIntoView({block: "nearest"});
	card.focus({preventScroll: true, focusVisible: true});
	card.setAttribute(LANDING_ATTR, "overlay");

	const clear = () => {
		card.removeAttribute(LANDING_ATTR);
		card.removeEventListener("keydown", onKeyDown, true);
		card.removeEventListener("beforeinput", clear, true);
		card.removeEventListener("pointerdown", clear, true);
		card.removeEventListener("focusout", onFocusOut);
		window.removeEventListener("blur", clear);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (!MODIFIER_KEYS.has(event.key)) clear();
	};
	const onFocusOut = (event: FocusEvent) => {
		const next = event.relatedTarget;
		if (next instanceof Node && card.contains(next)) return;
		clear();
	};
	card.addEventListener("keydown", onKeyDown, true);
	card.addEventListener("beforeinput", clear, true);
	card.addEventListener("pointerdown", clear, true);
	card.addEventListener("focusout", onFocusOut);
	window.addEventListener("blur", clear);
}
