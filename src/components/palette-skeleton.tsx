/** Upstream's cds SkeletonGroup title-bar widths, cycled down the rows. */
const TITLE_WIDTHS = [224, 176, 256, 200, 160, 240, 192] as const;
const ROWS = 13;
/** Upstream's --cds-skel-i counts 0..21 and restarts (lockstep groups of 11 rows). */
const WAVE_PERIOD = 22;

function bar(index: number, width: number, height: number) {
	return (
		<div
			data-skeleton=""
			data-cds="Skeleton"
			className="h-[1em] max-w-full rounded bg-[var(--skeleton-base)]"
			style={{width: `${width}px`, height: `${height}px`, ["--skel-i" as string]: index % WAVE_PERIOD}}
		/>
	);
}

/**
 * Upstream's settling SkeletonGroup (data-motion=wave): 13 full-width h-9 rows that grow to fill the
 * list and wrap any overflow into a hidden column, so the block never scrolls. The data-cds/data-hold
 * attributes and the display:contents wrapper copy upstream's markup; the inline bar size beats h-[1em].
 */
export function PaletteSkeleton() {
	return (
		<div
			data-palette-skeleton=""
			data-cds="SkeletonGroup"
			data-motion="wave"
			data-hold="none"
			data-hold-reason="predicted-slow"
			data-shown=""
			aria-hidden="true"
			className="flex min-h-0 grow basis-0 flex-col flex-wrap content-start overflow-hidden"
		>
			<div aria-hidden="true" className="contents">
				{Array.from({length: ROWS}, (_, row) => (
					<div key={row} className="flex shrink-0 items-center gap-2 px-3 py-2 box-border h-9 w-full">
						{bar(row * 2, 20, 20)}
						{bar(row * 2 + 1, TITLE_WIDTHS[row % TITLE_WIDTHS.length] ?? 0, 14)}
					</div>
				))}
			</div>
		</div>
	);
}
