import type {KeyboardEvent} from "react";

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Upstream's `panelScale`: the palette recedes to this while the card is open. */
const RECEDE_SCALE = 0.97;
/** Upstream's `cardLift`. */
const CARD_LIFT_PX = 4;
/** Upstream's `cardOverlap`: the card's inline-start edge sits this far over the receded palette. */
export const CARD_OVERLAP_PX = 44;

/**
 * Upstream's card anchor: the results list's x and width at the selected row's y (clamped into the list
 * viewport), scaled by the recede about the dialog's centre unless motion is reduced, then lifted 4px.
 */
export function rowActionsAnchorRect({
	list,
	row,
	dialog,
	reducedMotion,
}: {
	list: Box;
	row: Pick<Box, "y" | "height">;
	dialog: Box;
	reducedMotion: boolean;
}): Box {
	const y = Math.min(Math.max(row.y, list.y), Math.max(list.y, list.y + list.height - row.height));
	const scale = reducedMotion ? 1 : RECEDE_SCALE;
	const centreX = dialog.x + dialog.width / 2;
	const centreY = dialog.y + dialog.height / 2;
	return {
		x: centreX + (list.x - centreX) * scale,
		y: centreY + (y - centreY) * scale - CARD_LIFT_PX,
		width: list.width * scale,
		height: row.height * scale,
	};
}

export function virtualAnchor(box: Box) {
	return {
		getBoundingClientRect: () => ({
			...box,
			top: box.y,
			left: box.x,
			right: box.x + box.width,
			bottom: box.y + box.height,
			toJSON: () => box,
		}),
	};
}

/** Upstream's `Cs`: Enter with Alt or AltGraph, no Shift or Meta, not mid-IME composition. */
export function isAltEnter(event: KeyboardEvent<HTMLElement>): boolean {
	return (
		event.key === "Enter" &&
		(event.altKey || event.getModifierState("AltGraph")) &&
		!event.shiftKey &&
		!event.metaKey &&
		!event.nativeEvent.isComposing
	);
}
