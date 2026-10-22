import {assertNever} from "../../lib/assert-never";
export type TooltipSide = "top" | "bottom" | "left" | "right";
/** Where the tip sits along the trigger's cross axis: centred on it, or flush with its start edge. */
export type TooltipAlign = "start" | "center";

export interface TooltipRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface TooltipPlacement {
	side: TooltipSide;
	/** Pixels to move the tooltip along the x axis from its default spot on `side`. */
	shiftX: number;
	/** Pixels to move the tooltip along the y axis from its default spot on `side`. */
	shiftY: number;
}

/** The gap between the trigger and the tooltip (upstream's offset 4). */
const OFFSET = 4;
/** How far inside the viewport edges a tooltip is kept. */
const EDGE_PADDING = 8;

const OPPOSITE: Record<TooltipSide, TooltipSide> = {top: "bottom", bottom: "top", left: "right", right: "left"};

function fitsOnSide(
	trigger: TooltipRect,
	tip: {width: number; height: number},
	viewport: {width: number; height: number},
	side: TooltipSide,
) {
	switch (side) {
		case "top":
			return trigger.top - OFFSET - tip.height >= 0;
		case "bottom":
			return trigger.top + trigger.height + OFFSET + tip.height <= viewport.height;
		case "left":
			return trigger.left - OFFSET - tip.width >= 0;
		case "right":
			return trigger.left + trigger.width + OFFSET + tip.width <= viewport.width;
		default:
			return assertNever(side);
	}
}

/** The shift that moves a span starting at `start` with `size` inside [EDGE_PADDING, limit - EDGE_PADDING]. */
function clampShift(start: number, size: number, limit: number) {
	if (start < EDGE_PADDING) return EDGE_PADDING - start;
	const overflow = start + size - (limit - EDGE_PADDING);
	return overflow > 0 ? Math.max(-overflow, EDGE_PADDING - start) : 0;
}

/**
 * Where a tooltip goes: on `side` when it fits, flipped to the opposite side when only that fits, and shifted along
 * the cross axis (from its `align` spot) so it stays 8px inside the viewport.
 */
export function placeTooltip(
	trigger: TooltipRect,
	tip: {width: number; height: number},
	viewport: {width: number; height: number},
	side: TooltipSide,
	align: TooltipAlign = "center",
): TooltipPlacement {
	const placed =
		!fitsOnSide(trigger, tip, viewport, side) && fitsOnSide(trigger, tip, viewport, OPPOSITE[side])
			? OPPOSITE[side]
			: side;
	if (placed === "top" || placed === "bottom") {
		const left = align === "start" ? trigger.left : trigger.left + trigger.width / 2 - tip.width / 2;
		return {side: placed, shiftX: clampShift(left, tip.width, viewport.width), shiftY: 0};
	}
	const top = align === "start" ? trigger.top : trigger.top + trigger.height / 2 - tip.height / 2;
	return {side: placed, shiftX: 0, shiftY: clampShift(top, tip.height, viewport.height)};
}

/** The gap between a menu row and its side tooltip (upstream's `sideOffset: 8`). */
const ROW_SIDE_OFFSET = 8;

export interface RowTooltipPlacement {
	/** Pixels from the popup's left edge. */
	left: number;
	/** Pixels from the popup's top edge, level with the row's top (`align: start`). */
	top: number;
	/** Upstream's `max(9rem, --available-width - 1rem)`: the room between the tip's start and the viewport edge. */
	maxWidth: string;
}

/**
 * Where a menu row's tooltip goes, as an absolute position inside the row's popup: upstream's `side: inline-end`,
 * `align: start`, `sideOffset: 8`, anchored to the row element rather than the popup, with no side flip
 * (`fallbackAxisSide: "none"`). Both rects are viewport rects, so a scrolled row carries its scroll offset.
 */
export function placeRowTooltip(row: TooltipRect, popup: TooltipRect): RowTooltipPlacement {
	const viewportLeft = row.left + row.width + ROW_SIDE_OFFSET;
	return {
		left: viewportLeft - popup.left,
		top: row.top - popup.top,
		maxWidth: `max(9rem, calc(100vw - ${viewportLeft}px - 1rem))`,
	};
}
