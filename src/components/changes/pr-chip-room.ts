import {type RefObject, useLayoutEffect, useRef, useState} from "react";

/** How much of the Changes header PR chip fits: the `#N` link, the icon-only link, or nothing (upstream `PC`). */
export type ChipRoom = "number" | "short" | "none";

/** Upstream `MC`: the margin a grow step needs beyond the room it takes. */
const CHIP_ROOM_SLACK_PX = 8;

/** Upstream `NC`: the chip gives up its room before the scope label would go below 8rem. */
const SCOPE_LABEL_FLOOR_REM = 8;

/** Under this much free row width the chip starts shrinking. */
const TIGHT_PX = 2;

/**
 * The room's classes. In `none` it also takes `w-0`: the empty `h-full` span holds the first flex line, the parts
 * wrap onto a second line 3rem lower that the clip hides, and keyboard focus or an open popup restores the width.
 */
export const CHIP_ROOM_CLASS =
	"-ms-1 flex h-control shrink-0 flex-wrap gap-y-12 overflow-y-clip has-[:focus-visible]:w-auto has-[:focus-visible]:overflow-y-visible has-[[data-popup-open]]:w-auto";

export interface ChipRoomMeasure
{
	/** The header title row's client width (`lead.parentElement`). */
	rowWidth: number;
	/** The header lead's width (the chip's parent). */
	leadWidth: number;
	/** The `[data-diff-scope-label]` element's width, or null without one. */
	scopeLabelWidth: number | null;
	rootFontSize: number;
	/** The chip link's current width. */
	linkWidth: number;
	/** The chip parts' width (link plus CI). */
	partsWidth: number;
	/** The link's width when it last showed the number. */
	numberLinkWidth: number;
	/** A list note badge sits before the chip. */
	afterBadge: boolean;
}

/** One fit step of upstream's `PC`; `grown` is true for a resize, false for the step after a render. */
export function nextChipRoom(
	state: ChipRoom,
	m: ChipRoomMeasure,
	grown: boolean,
):
{
	state: ChipRoom;
	numberLinkWidth: number;
}
{
	const unchanged =
	{
		state,
		numberLinkWidth: m.numberLinkWidth,
	};
	if (m.rowWidth === 0) return unchanged;
	const free = m.rowWidth - m.leadWidth;
	const tight = free < TIGHT_PX;
	const give = (m.scopeLabelWidth ?? 0) - SCOPE_LABEL_FLOOR_REM * m.rootFontSize;
	const badge = m.afterBadge && m.scopeLabelWidth !== null;
	const pressed = tight || badge;
	if (state === "number")
		return {
			state: tight || (pressed && give <= 0) ? "short" : "number",
			numberLinkWidth: m.linkWidth,
		};
	if (state === "short")
	{
		if (pressed && give <= 0)
			return {
				...unchanged,
				state: "none",
			};
		if (grown && free > m.numberLinkWidth - m.linkWidth + CHIP_ROOM_SLACK_PX)
			return {
				...unchanged,
				state: "number",
			};
		return unchanged;
	}
	if (grown && !(badge && give <= 0) && free + Math.max(0, give) > m.partsWidth + CHIP_ROOM_SLACK_PX)
		return {
			...unchanged,
			state: "short",
		};
	return unchanged;
}

function rootFontSize(): number
{
	return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * Upstream `PC`: fits the chip room to the header row, re-fitting whenever the row, the lead, the parts or the
 * scope label resizes. Starts at `number`.
 */
export function usePrChipRoom({
	chipRef,
	partsRef,
	afterBadge,
}: {
	chipRef: RefObject<HTMLElement | null>;
	partsRef: RefObject<HTMLElement | null>;
	afterBadge: boolean;
}): ChipRoom
{
	const [state, setState] = useState<ChipRoom>("number");
	const numberLinkWidth = useRef(0);
	useLayoutEffect(() =>
	{
		const chip = chipRef.current;
		const parts = partsRef.current;
		const lead = chip?.parentElement;
		const row = lead?.parentElement;
		if (!chip || !parts || !lead || !row) return undefined;
		const findLabel = () => lead.querySelector<HTMLElement>("[data-diff-scope-label]");
		let label = findLabel();
		const fit = (grown: boolean) =>
		{
			const next = nextChipRoom(
				state,
				{
					rowWidth: row.clientWidth,
					leadWidth: lead.offsetWidth,
					scopeLabelWidth: label?.offsetWidth ?? null,
					rootFontSize: rootFontSize(),
					linkWidth: chip.querySelector<HTMLElement>("a")?.offsetWidth ?? 0,
					partsWidth: parts.offsetWidth,
					numberLinkWidth: numberLinkWidth.current,
					afterBadge,
				},
				grown,
			);
			numberLinkWidth.current = next.numberLinkWidth;
			if (next.state !== state) setState(next.state);
		};
		const observer = new ResizeObserver(() =>
		{
			const current = findLabel();
			if (current !== label)
			{
				if (label !== null) observer.unobserve(label);
				if (current !== null) observer.observe(current);
				label = current;
			}
			fit(true);
		});
		observer.observe(row);
		observer.observe(lead);
		observer.observe(parts);
		if (label !== null) observer.observe(label);
		fit(false);
		return () =>
		{
			observer.disconnect();
		};
	}, [chipRef, partsRef, afterBadge, state]);
	return state;
}
