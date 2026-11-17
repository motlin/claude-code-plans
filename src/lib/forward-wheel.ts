/** Upstream ca80fca8d `Pi`: the pixels one wheel step scrolls for each deltaMode. */
function wheelUnit(deltaMode: number): number
{
	return deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1;
}

/**
 * Upstream ca80fca8d `Pi`: replays wheel input from an overlay onto the scroller under it.
 * The synthetic `wheel` lets the scroller's own listeners see the user's intent (releasing
 * a follow pin); `scrollBy` then moves it, since a synthetic event scrolls nothing.
 */
export function forwardWheel(
	scroller: Element,
	{
		deltaX,
		deltaY,
		deltaMode,
	}:
	{
		deltaX: number;
		deltaY: number;
		deltaMode: number;
	},
): void
{
	scroller.dispatchEvent(
		new WheelEvent(
			"wheel",
			{
				deltaX,
				deltaY,
				deltaMode,
			},
		),
	);
	const unit = wheelUnit(deltaMode);
	scroller.scrollBy(
		{
			top: deltaY * unit,
			left: deltaX * unit,
		},
	);
}
