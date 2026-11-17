import {useEffect, useRef} from "react";

/** Upstream's `sS`: how often the sentinel re-checks a painted (or stalled) card's visibility. */
const PAINT_POLL_MS = 250;
/** Upstream's `cS`: invisible frames in a row before the sentinel stops asking for frames. */
const PAINT_MISS_LIMIT = 3;
/** Upstream's `checkVisibility` options: CSS visibility, `content-visibility: auto` and `visibility` all hide. */
const PAINT_VISIBILITY_OPTIONS: CheckVisibilityOptions =
{
	checkVisibilityCSS: true,
	contentVisibilityAuto: true,
	visibilityProperty: true,
};

/**
 * Upstream's permission-card paint sentinel (`lS`): a hidden span watching its parent. Two visible animation frames in
 * a row report `onPainted`; a 250ms poll restarts a stalled count once the parent shows, and reports `onUnpainted`
 * when a painted parent stops being visible (display:none, content-visibility, visibility:hidden, a closed details).
 * Mounting reports `onUnpainted` first.
 */
export function ApprovalPaintSentinel({onPainted, onUnpainted}: {onPainted: () => void; onUnpainted: () => void})
{
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() =>
	{
		onUnpainted();
		const parent = ref.current?.parentElement;
		const view = parent?.ownerDocument.defaultView;
		if (parent === null || parent === undefined || view === null || view === undefined) return undefined;
		const visible = () =>
			typeof parent.checkVisibility !== "function" || parent.checkVisibility(PAINT_VISIBILITY_OPTIONS);
		let painted = false;
		let shown = 0;
		let missed = 0;
		let frame: number | undefined;
		const tick = () =>
		{
			frame = undefined;
			if (!visible())
			{
				shown = 0;
				missed += 1;
				if (missed <= PAINT_MISS_LIMIT) frame = view.requestAnimationFrame(tick);
				return;
			}
			missed = 0;
			shown += 1;
			if (shown < 2)
			{
				frame = view.requestAnimationFrame(tick);
				return;
			}
			painted = true;
			onPainted();
		};
		frame = view.requestAnimationFrame(tick);
		const poll = view.setInterval(() =>
		{
			if (visible())
			{
				if (!painted && frame === undefined)
				{
					shown = 0;
					missed = 0;
					frame = view.requestAnimationFrame(tick);
				}
				return;
			}
			if (frame !== undefined)
			{
				view.cancelAnimationFrame(frame);
				frame = undefined;
			}
			shown = 0;
			if (painted)
			{
				painted = false;
				onUnpainted();
			}
		}, PAINT_POLL_MS);
		return () =>
		{
			view.clearInterval(poll);
			if (frame !== undefined) view.cancelAnimationFrame(frame);
		};
	}, [onPainted, onUnpainted]);
	return <span ref={ref} hidden />;
}
