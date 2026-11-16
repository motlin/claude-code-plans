import type {Transform} from "@dnd-kit/utilities";

/** Upstream `X8`: how far the lifted pill reaches past the header label. */
const LIFTED_INSET = 10;

interface VerticalBox
{
	readonly top: number;
	readonly bottom: number;
}

interface Box extends VerticalBox
{
	readonly left: number;
}

/**
 * Upstream `IX`: the slot a dragged section lands in. Starting from its own index, each earlier
 * section whose midpoint the dragged top has moved above counts -1, and each later section whose
 * midpoint the dragged bottom has moved below counts +1.
 */
export function sectionSlotForOffset(
	tops: readonly number[],
	heights: readonly number[],
	index: number,
	dy: number,
): number
{
	const top = (tops[index] ?? 0) + dy;
	const bottom = top + (heights[index] ?? 0);
	return tops.reduce((slot, each, other) =>
	{
		const middle = each + (heights[other] ?? 0) / 2;
		if (other < index && top < middle) return slot - 1;
		if (other > index && bottom > middle) return slot + 1;
		return slot;
	}, index);
}

/** How far a dragged section may travel: up to the first manual section's top, down to the last one's bottom. */
export interface SectionDragBounds
{
	readonly up: number;
	readonly down: number;
}

/** Upstream `w`: the drag bounds of the section at `active` among every sortable section's box. */
export function sectionDragBounds(active: VerticalBox, sections: readonly VerticalBox[]): SectionDragBounds
{
	return {
		up: Math.min(...sections.map((section) => section.top)) - active.top,
		down: Math.max(...sections.map((section) => section.bottom)) - active.bottom,
	};
}

/**
 * Upstream's section drag modifier: x stays 0 and y stays inside the drag-start bounds, moved by
 * however far the scroll container has scrolled since the drag started.
 */
export function clampSectionDrag(
	transform: Transform,
	bounds: SectionDragBounds &
	{
		readonly scrollTop: number;
	},
	scrollTopNow: number,
): Transform
{
	const scrolled = scrollTopNow - bounds.scrollTop;
	return {
		...transform,
		x: 0,
		y: Math.min(Math.max(transform.y, bounds.up - scrolled), bounds.down - scrolled),
	};
}

/**
 * Upstream `ij`: the lifted pill's `--lifted-top` / `--lifted-x` / `--lifted-bottom` insets,
 * 10px around the section's name. With rows under the header it ends 3px past the section's
 * bottom; a header-only section ends 10px below the name.
 */
export function liftedInsets(
	section: Box,
	label: Box,
	name: Box,
	labelPaddingStart: number,
):
{
	top: number;
	x: number;
	bottom: number;
}
{
	return {
		top: name.top - LIFTED_INSET - section.top,
		x: label.left - section.left + labelPaddingStart - LIFTED_INSET,
		bottom: section.bottom - label.bottom > 1 ? -3 : section.bottom - name.bottom - LIFTED_INSET,
	};
}

/**
 * Upstream `XQ`: a press or key on an input, inside a `[data-row-action]` header control, or
 * outside the activator never drags or moves the section.
 */
export function ignoresSectionActivation(target: EventTarget, activator: Element): boolean
{
	return (
		target instanceof HTMLInputElement ||
		(target instanceof Element && target.closest("[data-row-action]") !== null) ||
		(target instanceof Node && !activator.contains(target))
	);
}
