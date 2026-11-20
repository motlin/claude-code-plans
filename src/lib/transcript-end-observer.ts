/**
 * Upstream `y0` (shared-31): two IntersectionObservers on the transcript end sentinel decide whether the jump-to-latest
 * control and the bottom fade show. Each root margin is measured from the top of the overlay (the composer dock) that
 * covers the scroller's bottom, and neither shows while the transcript follows the end.
 */

/** Upstream `z8`: the end sentinel's mark. */
export const TRANSCRIPT_END_SELECTOR = "[data-transcript-end]";

/** The transcript's follow state ("true" while it follows the end), read by the jump control outside it. */
export const TRANSCRIPT_FOLLOWING_ATTR = "data-transcript-following";

/** Upstream's fade margin: the end is more than 8px below the overlay top. */
const BOTTOM_FADE_MARGIN_PX = 8;

/** Upstream's jump margin: the end is more than 200px below the overlay top. */
export const JUMP_CONTROL_MARGIN_PX = 200;

export interface TranscriptEndState
{
	following: boolean;
	showJumpControl: boolean;
	showBottomFade: boolean;
}

function transcriptEndState(following: boolean, withinFade: boolean, withinJump: boolean): TranscriptEndState
{
	return {
		following,
		showJumpControl: !following && !withinJump,
		showBottomFade: !following && !withinFade,
	};
}

export function observeTranscriptEnd({
	scroller,
	sentinel,
	overlay,
	isFollowing,
	onChange,
}: {
	scroller: Element;
	sentinel: Element;
	overlay: Element | null;
	isFollowing: () => boolean;
	onChange: (state: TranscriptEndState) => void;
}):
{
	refresh: () => void;
	disconnect: () => void;
}
{
	let withinFade = true;
	let withinJump = true;
	let last = transcriptEndState(isFollowing(), withinFade, withinJump);
	const refresh = () =>
	{
		const next = transcriptEndState(isFollowing(), withinFade, withinJump);
		if (
			next.following === last.following &&
			next.showJumpControl === last.showJumpControl &&
			next.showBottomFade === last.showBottomFade
		)
			return;
		last = next;
		onChange(next);
	};
	let observers: IntersectionObserver[] = [];
	let overlayHeight: number | undefined;
	const watch = (margin: number, update: (within: boolean) => void) =>
	{
		const observer = new IntersectionObserver(
			(entries) =>
			{
				const entry = entries.at(-1);
				if (entry === undefined) return;
				update(entry.isIntersecting);
				refresh();
			},
			{
				root: scroller,
				rootMargin: `0px 0px ${margin - (overlayHeight ?? 0)}px 0px`,
			},
		);
		observer.observe(sentinel);
		return observer;
	};
	const build = () =>
	{
		const height = overlay?.getBoundingClientRect().height ?? 0;
		if (height === overlayHeight) return;
		overlayHeight = height;
		for (const observer of observers) observer.disconnect();
		observers = [
			watch(BOTTOM_FADE_MARGIN_PX, (within) =>
			{
				withinFade = within;
			}),
			watch(JUMP_CONTROL_MARGIN_PX, (within) =>
			{
				withinJump = within;
			}),
		];
	};
	build();
	const resizeObserver = new ResizeObserver(build);
	if (overlay !== null) resizeObserver.observe(overlay);
	return {
		refresh,
		disconnect: () =>
		{
			resizeObserver.disconnect();
			for (const observer of observers) observer.disconnect();
			observers = [];
		},
	};
}
