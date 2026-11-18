import {isMotionReduced} from "../lib/reduced-motion";
import
{
	cardFromThumbOffset,
	type Direction,
	THUMB_DEFAULT_HEIGHT,
	thumbCardPlacement,
	unscaledRect,
} from "./palette-thumb-geometry";
import {inlineEndSide} from "./ui/menu-anchor";

/** Upstream's `--cds-dur-snap` when the token is missing. */
const SNAP_FALLBACK_MS = 120;

/** Upstream's `ft`: a CSS time token in ms (`.12s` → 120). */
function durationMs(style: CSSStyleDeclaration, name: string): number
{
	const value = style.getPropertyValue(name).trim();
	if (value === "") return SNAP_FALLBACK_MS;
	const amount = Number.parseFloat(value);
	if (!Number.isFinite(amount)) return SNAP_FALLBACK_MS;
	return value.endsWith("ms") ? amount : amount * 1000;
}

/**
 * Upstream's `pt`: the thumb card slides from its old row's spot to the new one over duration-snap, continuing from
 * any slide still running. False when it can't slide (no WAAPI, reduced motion, a zero duration).
 */
export function slideThumb(el: HTMLElement, fromTop: number, toTop: number): boolean
{
	if (
		fromTop === toTop ||
		typeof el.animate !== "function" ||
		typeof el.getAnimations !== "function" ||
		isMotionReduced(el.ownerDocument)
	)
		return false;
	try
	{
		const style = getComputedStyle(el);
		const duration = durationMs(style, "--cds-dur-snap");
		const easing = style.getPropertyValue("--cds-ease-out").trim() || "linear";
		if (duration === 0) return false;
		const running = el.getAnimations();
		const ty =
			running.length > 0 && style.transform !== "" && style.transform !== "none"
				? new DOMMatrixReadOnly(style.transform).m42
				: 0;
		for (const animation of running) animation.cancel();
		el.animate(
			{
				transform: [`translateY(${fromTop + ty - toTop}px)`, "translateY(0)"],
			},
			{
				duration,
				easing,
			},
		);
		return true;
	}
	catch
	{
		return false;
	}
}

export interface ThumbPlacement
{
	rowKey: string;
	top: number;
	left: number;
	/** The offset back to the row-actions card's spot, measured only while returning from it. */
	fromCard:
	{
		x: number;
		y: number;
	} | null;
}

function direction(): Direction
{
	return inlineEndSide() === "left" ? "rtl" : "ltr";
}

export function findRow(list: HTMLElement, rowKey: string): HTMLElement | null
{
	return list.querySelector<HTMLElement>(`[cmdk-item][data-value="${CSS.escape(rowKey)}"]`);
}

/** The thumb card's DOM measure: its placement beside the dialog, and the card offset while returning. */
export function measureThumbCard({
	list,
	rowKey,
	cardHeight,
	returning,
}: {
	list: HTMLElement;
	rowKey: string;
	cardHeight: number;
	returning: boolean;
}): ThumbPlacement | null
{
	const row = findRow(list, rowKey);
	const dialog = list.closest<HTMLElement>('[role="dialog"]');
	if (row === null || dialog === null) return null;
	// The list recedes with the palette panel (upstream's dialog) while the row-actions card opens or closes.
	const panel = list.closest<HTMLElement>("[data-palette-recede-card]") ?? dialog;
	const input =
	{
		dialog: unscaledRect(dialog.getBoundingClientRect(), dialog),
		list: unscaledRect(list.getBoundingClientRect(), panel),
		row: unscaledRect(row.getBoundingClientRect(), panel),
		viewport:
		{
			width: document.documentElement.clientWidth,
			height: document.documentElement.clientHeight,
		},
		cardHeight,
		dir: direction(),
	};
	const place = thumbCardPlacement(input);
	if (place === null) return null;
	return {
		rowKey,
		top: place.top,
		left: place.left,
		fromCard: returning
			? cardFromThumbOffset(
					{
						...input,
						reducedMotion: isMotionReduced(),
					},
				)
			: null,
	};
}

/** The row-actions card's offset from the thumb card, for its morph (upstream's `Re` in the card shell). */
export function cardMorphOffset(
	list: HTMLElement,
	rowKey: string,
):
{
	x: number;
	y: number;
} | null
{
	return (
		measureThumbCard(
			{
				list,
				rowKey,
				cardHeight: THUMB_DEFAULT_HEIGHT,
				returning: true,
			},
		)?.fromCard ?? null
	);
}
