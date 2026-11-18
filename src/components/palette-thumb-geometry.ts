import {type Box, CARD_OVERLAP_PX, rowActionsAnchorRect} from "./palette-row-actions-geometry";

/** Upstream's thumb card width (`w-[280px]`). */
export const THUMB_CARD_WIDTH = 280;
/** Upstream's `mt`: the gap between the palette and the thumb card. */
const THUMB_GAP_PX = 12;
/** Upstream's `gt`: the thumb card keeps this far inside the viewport. */
const THUMB_EDGE_PX = 16;
/** The thumb card's height before its first measure. */
export const THUMB_DEFAULT_HEIGHT = 204;
/** Upstream's `V`: the row-actions card keeps this far inside the viewport. */
const CARD_EDGE_PX = 5;

export type Direction = "ltr" | "rtl";

interface Size
{
	width: number;
	height: number;
}

interface PlacementInput
{
	dialog: Box;
	list: Box;
	row: Pick<Box, "y" | "height">;
	viewport: Size;
	cardHeight: number;
	dir: Direction;
}

/** Upstream's `xt`: the row's y clamped into the list viewport. */
function clampedRowY(list: Box, row: Pick<Box, "y" | "height">): number
{
	return Math.min(Math.max(row.y, list.y), Math.max(list.y, list.y + list.height - row.height));
}

/**
 * Upstream's `St`: the thumb card sits 12px past the palette's inline-end edge (within a 16px viewport gutter)
 * at the selected row's y, kept 16px above the viewport bottom. `top`/`left` are relative to the slot at the
 * dialog's top right. Null when the card would cross the dialog's centre, so narrow viewports show no card.
 */
export function thumbCardPlacement({dialog, list, row, viewport, cardHeight, dir}: PlacementInput):
{
	x: number;
	y: number;
	top: number;
	left: number;
} | null
{
	const centre = dialog.x + dialog.width / 2;
	const right = dialog.x + dialog.width;
	const x =
		dir === "rtl"
			? Math.max(dialog.x - THUMB_GAP_PX - THUMB_CARD_WIDTH, THUMB_EDGE_PX)
			: Math.min(right + THUMB_GAP_PX, viewport.width - THUMB_EDGE_PX - THUMB_CARD_WIDTH);
	if (dir === "rtl" ? x + THUMB_CARD_WIDTH > centre : x < centre) return null;
	const y = Math.min(clampedRowY(list, row), Math.max(viewport.height - THUMB_EDGE_PX - cardHeight, dialog.y));
	return {
		x,
		y,
		top: y - dialog.y,
		left: x - right,
	};
}

/**
 * Upstream's `Ct`: how far the thumb card sits from where the row-actions card will open over the receded palette,
 * so the card can morph out of the thumb (and the thumb back out of the card). Null when there is no thumb card.
 */
export function cardFromThumbOffset(
	input: PlacementInput &
	{
		reducedMotion: boolean;
	},
):
{
	x: number;
	y: number;
} | null
{
	const place = thumbCardPlacement(input);
	if (place === null) return null;
	const {dialog, list, row, viewport, reducedMotion, dir} = input;
	const anchor = rowActionsAnchorRect(
		{
			list,
			row,
			dialog,
			reducedMotion,
		},
	);
	const cardX =
		dir === "rtl"
			? Math.max(anchor.x + CARD_OVERLAP_PX - THUMB_CARD_WIDTH, CARD_EDGE_PX)
			: Math.min(anchor.x + anchor.width - CARD_OVERLAP_PX, viewport.width - CARD_EDGE_PX - THUMB_CARD_WIDTH);
	return {
		x: place.x - cardX,
		y: place.y - anchor.y,
	};
}

/**
 * Upstream's `U(rect, dialog, 1)`: undoes a running scale on the dialog (its open zoom), so measures taken
 * mid-animation land where the settled dialog will be.
 */
export function unscaledRect(rect: Box, dialog: HTMLElement): Box
{
	if (dialog.offsetWidth === 0) return rect;
	const box = dialog.getBoundingClientRect();
	const scale = box.width / dialog.offsetWidth;
	if (!(scale > 0)) return rect;
	const centre = box.x + box.width / 2;
	return {
		x: centre + (rect.x - centre) / scale,
		y: box.y + (rect.y - box.y) / scale,
		width: rect.width / scale,
		height: rect.height / scale,
	};
}
