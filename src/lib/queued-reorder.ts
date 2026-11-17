import type {Modifier, UniqueIdentifier} from "@dnd-kit/core";

/**
 * Upstream's queue-band drag modifier: x locked to 0, y clamped so the dragged row stays inside its
 * first scrollable ancestor (the band's scrolling list). Without either rect it only locks x.
 */
export const clampQueueDragToList: Modifier = ({transform, draggingNodeRect, scrollableAncestorRects}) =>
{
	const list = scrollableAncestorRects[0];
	if (draggingNodeRect === null || list === undefined)
		return {
			...transform,
			x: 0,
		};
	return {
		...transform,
		x: 0,
		y: Math.min(
			Math.max(transform.y, list.top - draggingNodeRect.top),
			list.top + list.height - draggingNodeRect.bottom,
		),
	};
};

/** Upstream's drag end: reorder only on a drop over a different row. */
export function queuedDragEnd(
	{
		active,
		over,
	}:
	{
		active:
		{
			id: UniqueIdentifier;
		};
		over:
		{
			id: UniqueIdentifier;
		} | null;
	},
	onReorder: (id: string, overId: string) => void,
): void
{
	if (over === null || active.id === over.id) return;
	onReorder(String(active.id), String(over.id));
}

const MASK_WIDE = "[mask-image:linear-gradient(to_right,black_calc(100%_-_120px),transparent_calc(100%_-_48px))]";
const MASK_NARROW = "[mask-image:linear-gradient(to_right,black_calc(100%_-_76px),transparent_calc(100%_-_28px))]";

/**
 * Upstream's row text mask, making room for the actions: 120/48 with a reorder handle, 76/28 with only the
 * ⋯; static while the row is held (dragged or its menu open), none while another row is dragged, and
 * otherwise on hover or a coarse pointer.
 */
export function queuedRowMask({
	sortable,
	held,
	otherDragging,
}: {
	sortable: boolean;
	held: boolean;
	otherDragging: boolean;
}): string
{
	const mask = sortable ? MASK_WIDE : MASK_NARROW;
	if (held) return mask;
	if (otherDragging) return "";
	return `group-hover/row:${mask} pointer-coarse:${mask}`;
}
