import {useCallback, type RefCallback} from "react";

/** Set on the start card's wrapper when Next steps doesn't fit above the composer (upstream's `gG`). */
const START_CARD_SETUP_HIDDEN = "data-start-card-setup-hidden";
/** Marks a card that hides when its wrapper carries {@link START_CARD_SETUP_HIDDEN} (upstream's `_G`). */
const START_CARD_SETUP = "data-start-card-setup";
/** Upstream's `vG`: the class that hides a {@link START_CARD_SETUP} card while it doesn't fit. */
export const START_CARD_SETUP_HIDE_CLASS = "[[data-start-card-setup-hidden]_&]:hidden";
/** Marks the env card whose height the start card centres on (upstream's `wZ`). */
export const START_CARD_ENVIRONMENTS = "data-start-card-environments";
/** Upstream's start card wrapper (`IZ`): a spacer whose max-height is set by {@link useStartCardPlacement}, then the slot. */
export const START_CARD_WRAPPER_CLASS = "flex min-h-full w-full flex-col pb-6";
/** Upstream's spacer above the slot: it grows into the free space up to its max-height. */
export const START_CARD_SPACER_CLASS = "max-h-0 grow basis-0";

/** Upstream's `TZ`: the composer clearance, in rem, subtracted from the composer's bottom edge. */
const PROMPT_CLEARANCE_REM = 2.75;
/** Upstream's `DZ`: the fixed allowance, in px, added to the env card's height. */
const ALLOWANCE_PX = 2;

/** Upstream's `kZ(1, hasList)`: one env card's allowance in rem, 0.75rem more when it shows. */
function allowanceRem(hasList: boolean): number {
	return 2.5 + (hasList ? 0.75 : 0);
}

export interface StartCardPlacementInput {
	/** The scroller's height. */
	room: number;
	/** From the scroller's top to the composer's bottom edge less 2.75rem. */
	rest: number;
	/** The env card's height, 0 without one. */
	list: number;
	/** The root font size in px. */
	rem: number;
	/** The start card's height without Next steps. */
	environments: number;
	/** Next steps' height, including the gap above it. */
	setup: number;
	/** The wrapper's padding-bottom. */
	foot: number;
	/** Whether Next steps is hidden already; it needs one more pixel to come back. */
	hidden: boolean;
}

/**
 * Upstream's `AZ`: centre only the env card (plus an allowance) in the space above the composer, so Next steps
 * hangs below it, and hide Next steps when the card plus Next steps plus the foot would overflow the scroller.
 */
export function placeStartCard({room, rest, list, rem, environments, setup, foot, hidden}: StartCardPlacementInput): {
	top: number;
	setupFits: boolean;
} {
	const allow = list + ALLOWANCE_PX + allowanceRem(list > 0) * rem;
	const top = Math.max(0, (rest - allow) / 2);
	return {top, setupFits: top + environments + setup + foot + (hidden ? 1 : 0) <= room};
}

/** Upstream's `NZ`: a card's height plus the gap above it. */
function stackedHeight(total: number, card: HTMLElement): number {
	const previous = card.previousElementSibling;
	return (
		total +
		(previous ? card.getBoundingClientRect().bottom - previous.getBoundingClientRect().bottom : card.offsetHeight)
	);
}

/**
 * Upstream's `MZ`: watch the scroller (the wrapper's parent), the card slot (its second child) and the env card, and
 * on every resize set the spacer's (its first child's) max-height and toggle {@link START_CARD_SETUP_HIDDEN}.
 */
function observeStartCardPlacement(wrapper: HTMLElement): (() => void) | undefined {
	const scroller = wrapper.parentElement;
	const [spacer, slot] = wrapper.children;
	const view = wrapper.ownerDocument.defaultView;
	if (!scroller || !(spacer instanceof HTMLElement) || !(slot instanceof HTMLElement) || !view) return undefined;
	const observer =
		typeof view.ResizeObserver === "function"
			? new view.ResizeObserver(() => {
					place();
				})
			: undefined;
	// Hidden cards measure 0, so the last visible measurement is kept while they are hidden.
	let setup = 0;
	let list: Element | null = null;
	const place = () => {
		const composer = wrapper.ownerDocument.querySelector("[data-home-composer] [data-composer-card]");
		const cards = [...slot.querySelectorAll<HTMLElement>(`[${START_CARD_SETUP}]`)];
		const visible = cards.some((card) => card.offsetHeight > 0);
		if (cards.length === 0) setup = 0;
		else if (visible) setup = cards.reduce(stackedHeight, 0);
		const box = scroller.getBoundingClientRect();
		const style = view.getComputedStyle(wrapper);
		const fontSize = Number.parseFloat(view.getComputedStyle(wrapper.ownerDocument.documentElement).fontSize);
		const rem = Number.isNaN(fontSize) ? 16 : fontSize;
		const clearance =
			PROMPT_CLEARANCE_REM * rem * (Number.parseFloat(style.getPropertyValue("--cds-rem-scale")) || 1);
		const environments = slot.querySelector(`[${START_CARD_ENVIRONMENTS}]`);
		if (environments !== list) {
			if (list) observer?.unobserve(list);
			if (environments) observer?.observe(environments);
			list = environments;
		}
		const foot = Number.parseFloat(style.paddingBottom);
		const {top, setupFits} = placeStartCard({
			room: box.height,
			rest: composer ? composer.getBoundingClientRect().bottom - clearance - box.top : box.height,
			list: environments?.getBoundingClientRect().height ?? 0,
			rem,
			environments: slot.getBoundingClientRect().height - (visible ? setup : 0),
			setup,
			foot: Number.isNaN(foot) ? 0 : foot,
			hidden: wrapper.hasAttribute(START_CARD_SETUP_HIDDEN),
		});
		spacer.style.maxHeight = `${top}px`;
		wrapper.toggleAttribute(START_CARD_SETUP_HIDDEN, !setupFits);
	};
	// jsdom has no ResizeObserver; the one placement below is all it gets.
	if (observer) {
		observer.observe(scroller);
		observer.observe(slot);
	}
	place();
	return () => {
		observer?.disconnect();
	};
}

/** A ref for the start card wrapper that keeps it centred above the composer (upstream's `SG`). */
export function useStartCardPlacement(): RefCallback<HTMLDivElement> {
	return useCallback(
		(wrapper: HTMLDivElement | null) => (wrapper ? observeStartCardPlacement(wrapper) : undefined),
		[],
	);
}
