/** Upstream's cds SkeletonGroup title-bar widths, cycled down the rows. */
const TITLE_WIDTHS = [224, 176, 256, 200, 160, 240, 192] as const;
const ROWS = 13;
/** Upstream's --cds-skel-i counts 0..21 and restarts (lockstep groups of 11 rows). */
const WAVE_PERIOD = 22;

function bar(index: number, width: number, height: number)
{
	return (
		<div
			data-skeleton=""
			data-cds="Skeleton"
			className="h-[1em] max-w-full rounded bg-[var(--skeleton-base)]"
			style={
			{
				width: `${width}px`,
				height: `${height}px`,
				["--skel-i" as string]: index % WAVE_PERIOD,
			}}
		/>
	);
}

/**
 * Upstream's settling SkeletonGroup (data-motion=wave): 13 full-width h-9 rows that grow to fill the
 * list and wrap any overflow into a hidden column, so the block never scrolls. The data-cds/data-hold
 * attributes and the display:contents wrapper copy upstream's markup; the inline bar size beats h-[1em].
 * `lead="spacer"` is upstream's `Eh(true, h-3)` variant, picked when the last group is the untitled actions
 * group and no results group exists yet: a 12px spacer (the 4px list gap plus a results group's mt-2) with no
 * bar, so the wave indices stay the same.
 */
export function PaletteSkeleton({lead}: {lead?: "spacer"})
{
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
				{lead === "spacer" && <div className="h-3 w-full shrink-0" />}
				{Array.from(
					{
						length: ROWS,
					},
					(_, row) => (
						<div key={row} className="flex shrink-0 items-center gap-2 px-3 py-2 box-border h-9 w-full">
							{bar(row * 2, 20, 20)}
							{bar(row * 2 + 1, TITLE_WIDTHS[row % TITLE_WIDTHS.length] ?? 0, 14)}
						</div>
					),
				)}
			</div>
		</div>
	);
}

/** Upstream `XG`: a 37px group-heading row holding one 10px title bar. */
function titleBar(index: number, width: number)
{
	return (
		<div key={`title-${index}`} className="box-border flex h-[37px] w-full shrink-0 items-center px-3.5 pt-3 pb-2">
			{bar(index, width, 10)}
		</div>
	);
}

function gap(key: string)
{
	return <div key={key} className="h-1 w-full shrink-0" />;
}

/** Upstream `zh`'s groups: [title width, rows, width offset], mirroring Needs attention/Recents, Recents and Actions. */
const EMPTY_VIEW_GROUPS = [
	[88, 1, 0],
	[56, 5, 1],
	[56, 2, 6],
] as const;

function emptyViewChildren()
{
	let index = 0;
	return EMPTY_VIEW_GROUPS.flatMap(([title, rows, offset], groupIndex) => [
		...(groupIndex === 0 ? [] : [gap(`gap-${groupIndex}`)]),
		titleBar(index++, title),
		...Array.from(
			{
				length: rows,
			},
			(_, row) =>
			{
				const first = index;
				index += 2;
				return (
					<div
						key={`row-${first}`}
						className="flex shrink-0 items-center gap-2 px-3 py-2 box-border h-9 w-full"
					>
						{bar(first, 20, 20)}
						{bar(first + 1, TITLE_WIDTHS[(row + offset) % TITLE_WIDTHS.length] ?? 0, 14)}
					</div>
				);
			},
		),
	]);
}

/**
 * Upstream's empty-view pending skeleton (`zh(handoff)` in the palette chunk): three titled groups shaped like the
 * settled Recents/Actions view, drawn while the opening's empty view hasn't settled. Unlike the typed-search
 * skeleton it is announced: role=status with an sr-only label. A `delayed` hold fades in after
 * `--placeholder-reveal-delay` and fills the label as the reveal starts; the `handoff` hold (taking over from the
 * cold-load shell) shows and announces at once.
 */
export function PaletteEmptyViewSkeleton({handoff = false}: {handoff?: boolean})
{
	return (
		<div
			data-palette-skeleton=""
			data-cds="SkeletonGroup"
			data-motion="wave"
			data-hold={handoff ? "none" : "delayed"}
			data-hold-reason={handoff ? "handoff" : undefined}
			data-shown={handoff ? "" : undefined}
			role="status"
			className="flex min-h-0 grow basis-0 flex-col flex-wrap content-start overflow-hidden"
			onAnimationStart={(event) =>
			{
				if (event.animationName !== "placeholder-reveal" || event.target !== event.currentTarget) return;
				event.currentTarget.setAttribute("data-shown", "");
				const label = event.currentTarget.querySelector("[data-skeleton-label]");
				if (label !== null && label.textContent === "") label.textContent = "Loading";
			}}
		>
			<span className="sr-only" data-skeleton-label="">
				{handoff ? "Loading" : ""}
			</span>
			<div aria-hidden="true" className="contents">
				{emptyViewChildren()}
			</div>
		</div>
	);
}
