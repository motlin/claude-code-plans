import {minTileSize, resolveFlexes, type PaneKind, type StackNode} from "./pane-layout";

/**
 * Upstream ca67f2c9d `pU(true)`, the line-mode tiles config the overlay maths runs on: `gap`, `padding`,
 * `minTileWidthPx`. The live capture's 357px reserve is a 356px pane plus the 1px gap.
 */
export const OVERLAY_SPLIT =
{
	gap: 1,
	padding: 0,
	minTileWidthPx: 280,
} as const;

/** Upstream `chatAloneInsetPx` (8 + the composer dock's overhang, none locally). */
const CHAT_ALONE_INSET_PX = 8;

/** Upstream's drawn overlay: the pane's width, the flex its settled split keeps it at, and the room it reserves. */
export interface OverlayFit
{
	width: number;
	paneFlex: number;
	reservePx: number;
}

/**
 * Upstream cc43287c9 `VPe`'s spare width: the tile root less its padding, the lone chat's end inset, the chat column
 * (with any docked rail overhang) and the transcript's scrollbar.
 */
export function overlaySpareWidth({
	containerWidth,
	chatColumnWidth,
	scrollbarWidth,
}: {
	containerWidth: number;
	chatColumnWidth: number;
	scrollbarWidth: number;
}): number
{
	return containerWidth - 2 * OVERLAY_SPLIT.padding - CHAT_ALONE_INSET_PX - chatColumnWidth - scrollbarWidth;
}

/**
 * Upstream cc43287c9 `FPe`: the overlay is as wide as the pane's split tile but fits the spare width less a gap, in
 * even pixels and never under 280px. The settled split's pane flex keeps that width; the reserve adds the gap and
 * the end padding. Null when the pane is not a root-row tile or there is no room.
 */
export function overlayFit({
	root,
	tileId,
	containerWidth,
	spareWidth,
}: {
	root: StackNode;
	tileId: PaneKind;
	containerWidth: number;
	spareWidth: number;
}): OverlayFit | null
{
	if (root.direction !== "row") return null;
	const index = root.children.findIndex((child) => child.kind === "tile" && child.tileId === tileId);
	if (index === -1) return null;
	const {gap, padding, minTileWidthPx} = OVERLAY_SPLIT;
	const avail = containerWidth - 2 * padding - gap * (root.children.length - 1);
	const resolved = resolveFlexes(
		root.children.map((child) => child.flex),
		root.children.map((child) => minTileSize(child, "row")),
		avail,
	);
	const resolvedSum = resolved.reduce((sum, flex) => sum + flex, 0);
	const splitWidth = resolvedSum > 0 ? ((resolved[index] ?? 0) / resolvedSum) * avail : 0;
	const width = 2 * Math.floor(Math.min(splitWidth, spareWidth - gap) / 2);
	if (width < minTileWidthPx) return null;
	const othersFlex = root.children.reduce((sum, child, at) => (at === index ? sum : sum + child.flex), 0);
	if (avail <= width || othersFlex <= 0) return null;
	return {
		width,
		paneFlex: (othersFlex * width) / (avail - width),
		reservePx: width + gap + padding,
	};
}
