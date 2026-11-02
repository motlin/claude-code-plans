import {useCallback, useMemo, useRef} from "react";

interface PointerPosition
{
	x: number;
	y: number;
}

/**
 * claude.ai/code's pointer hover hook (`id`): a list records the pointer's screen position on mousemove
 * and forgets it on mouseleave; a row's mousemove selects only when a recorded position exists and
 * differs from the event's. So a list that opens under a resting cursor, or scrolls by keyboard under
 * one, doesn't steal the selection. The row handler runs before the list's (events bubble), so it
 * compares against the previous position.
 */
export function usePointerHoverSelect(select: (index: number) => void)
{
	const pointer = useRef<PointerPosition | null>(null);
	const recordPointer = useCallback((event: React.MouseEvent) =>
	{
		pointer.current =
		{
			x: event.screenX,
			y: event.screenY,
		};
	}, []);
	const forgetPointer = useCallback(() =>
	{
		pointer.current = null;
	}, []);
	const hoverSelect = useCallback(
		(index: number, event: React.MouseEvent) =>
		{
			const last = pointer.current;
			if (last === null || (last.x === event.screenX && last.y === event.screenY)) return;
			select(index);
		},
		[select],
	);
	return useMemo(
		() => (
		{
			recordPointer,
			forgetPointer,
			hoverSelect,
		}),
		[recordPointer, forgetPointer, hoverSelect],
	);
}
