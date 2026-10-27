import {useCallback, type RefCallback} from "react";

/** Set on the start card's wrapper when Next steps doesn't fit above the composer (upstream's `gG`). */
const START_CARD_SETUP_HIDDEN = "data-start-card-setup-hidden";
/** Marks a card that hides when its wrapper carries {@link START_CARD_SETUP_HIDDEN} (upstream's `_G`). */
const START_CARD_SETUP = "data-start-card-setup";
/** Upstream's `vG`: the class that hides a {@link START_CARD_SETUP} card while it doesn't fit. */
export const START_CARD_SETUP_HIDE_CLASS = "[[data-start-card-setup-hidden]_&]:hidden";
/** Upstream's start card wrapper (`OG`); its padding-top is set by {@link useStartCardPlacement}. */
export const START_CARD_WRAPPER_CLASS = "flex min-h-full w-full flex-col pb-6";

/** Upstream's `yG`: the composer clearance, in rem, subtracted from the composer's bottom edge. */
const PROMPT_CLEARANCE_REM = 2.75;
/** Upstream's `bG`: the space kept below the card. */
const BOTTOM = 24;

export interface StartCardPlacementInput {
	/** The scroller's clientHeight. */
	room: number;
	/** From the scroller's top to the composer's bottom edge less 2.75rem. */
	rest: number;
	/** The start card's height without Next steps. */
	environments: number;
	/** Next steps' height, including the gap above it. */
	setup: number;
	/** Whether Next steps is hidden already; it needs one more pixel to come back. */
	hidden: boolean;
}

/**
 * Upstream's `xG`: centre the card in the space above the composer, and hide Next steps when the card
 * plus Next steps plus the bottom gap would overflow the scroller.
 */
export function placeStartCard({room, rest, environments, setup, hidden}: StartCardPlacementInput): {
	top: number;
	setupFits: boolean;
} {
	const centred = Math.max(0, (rest - environments - setup) / 2);
	const setupFits = centred + environments + setup + BOTTOM + (hidden ? 1 : 0) <= room;
	const shown = setupFits ? environments + setup : environments;
	return {top: Math.max(0, Math.min(centred, room - BOTTOM - shown)), setupFits};
}

/** Upstream's `wG`: a card's height plus the gap above it. */
function stackedHeight(total: number, card: HTMLElement): number {
	const previous = card.previousElementSibling;
	return (
		total +
		(previous ? card.getBoundingClientRect().bottom - previous.getBoundingClientRect().bottom : card.offsetHeight)
	);
}

/**
 * Upstream's `CG`: watch the scroller (the wrapper's parent) and the card slot (its first child), and
 * on every resize set the wrapper's padding-top and toggle {@link START_CARD_SETUP_HIDDEN}.
 */
function observeStartCardPlacement(wrapper: HTMLElement): (() => void) | undefined {
	const scroller = wrapper.parentElement;
	const slot = wrapper.firstElementChild;
	const view = wrapper.ownerDocument.defaultView;
	if (!scroller || !(slot instanceof HTMLElement) || !view) return undefined;
	// Hidden cards measure 0, so the last visible measurement is kept while they are hidden.
	let setup = 0;
	const place = () => {
		const composer = wrapper.ownerDocument.querySelector("[data-home-composer] [data-composer-card]");
		const cards = [...slot.querySelectorAll<HTMLElement>(`[${START_CARD_SETUP}]`)];
		const visible = cards.some((card) => card.offsetHeight > 0);
		if (cards.length === 0) setup = 0;
		else if (visible) setup = cards.reduce(stackedHeight, 0);
		const room = scroller.clientHeight;
		const clearance =
			PROMPT_CLEARANCE_REM *
			Number.parseFloat(view.getComputedStyle(wrapper.ownerDocument.documentElement).fontSize);
		const {top, setupFits} = placeStartCard({
			room,
			rest: composer
				? composer.getBoundingClientRect().bottom -
					(Number.isNaN(clearance) ? 44 : clearance) -
					scroller.getBoundingClientRect().top
				: room,
			environments: slot.getBoundingClientRect().height - (visible ? setup : 0),
			setup,
			hidden: wrapper.hasAttribute(START_CARD_SETUP_HIDDEN),
		});
		wrapper.style.paddingTop = `${top}px`;
		wrapper.toggleAttribute(START_CARD_SETUP_HIDDEN, !setupFits);
	};
	place();
	// jsdom has no ResizeObserver; the one placement above is all it gets.
	if (typeof view.ResizeObserver !== "function") return undefined;
	const observer = new view.ResizeObserver(place);
	observer.observe(scroller);
	observer.observe(slot);
	return () => {
		observer.disconnect();
	};
}

/** A ref for the start card wrapper that keeps it centred above the composer (upstream's `SG`). */
export function useStartCardPlacement(): RefCallback<HTMLDivElement> {
	return useCallback(
		(wrapper: HTMLDivElement | null) => (wrapper ? observeStartCardPlacement(wrapper) : undefined),
		[],
	);
}
