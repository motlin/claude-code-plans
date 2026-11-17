import {Skeleton} from "../../ui/skeleton";

/** Upstream's skeleton bar widths (`Du`), cycled per row; a described row's description bar takes the next width. */
const BAR_WIDTHS = ["68%", "54%", "44%"] as const;

function barWidth(index: number): string
{
	return BAR_WIDTHS[index % BAR_WIDTHS.length] ?? "68%";
}

/**
 * Upstream's placeholder rows (`bp`), held in a list slot while its rows load. The block fades in
 * after `--placeholder-reveal-delay` (`.df-placeholder-rows`), so a fast load never flashes it.
 * `labelSpace` reserves a group label band above the rows. Each row is an iconless one-line row
 * (`eV`), or a two-line described row (`y4`) with Show ▸ Metadata on. Rows from `silentFrom` on
 * are aria-hidden; by default every row announces, as upstream's do.
 */
export function PlaceholderRows({
	rows,
	testId = "sidebar-rows-skeleton",
	labelSpace = false,
	className,
	described = false,
	silentFrom = rows,
}: {
	rows: number;
	testId?: string;
	labelSpace?: boolean;
	className?: string;
	described?: boolean;
	silentFrom?: number;
})
{
	return (
		<div
			className={
				className === undefined
					? "df-placeholder-rows flex flex-col gap-px"
					: `df-placeholder-rows flex flex-col gap-px ${className}`
			}
			data-testid={testId}
		>
			{labelSpace && (
				<div
					data-placeholder-label=""
					className="min-h-[calc(var(--sb-group-band-mt)+var(--sb-group-band-h))]"
				/>
			)}
			{Array.from(
				{
					length: rows,
				},
				(_, index) =>
					described ? (
						<DescribedPlaceholderRow key={index} index={index} silent={index >= silentFrom} />
					) : (
						<PlaceholderRow key={index} index={index} silent={index >= silentFrom} />
					),
			)}
		</div>
	);
}

/** Upstream `eV`, iconless as in the code list: one Skeleton bar at the row font's height. */
function PlaceholderRow({index, silent}: {index: number; silent: boolean})
{
	return (
		<div
			data-row=""
			className="flex h-[var(--sb-row-h)] items-center gap-[var(--sb-row-gap)] pe-[var(--sb-row-px)] ps-[var(--sb-row-px)]"
		>
			<span className="flex min-w-0 flex-1 items-center ps-[var(--sb-iconless-pad)]">
				<Skeleton
					silent={silent}
					className="h-[1em] rounded"
					style={
					{
						width: barWidth(index),
						height: "var(--sb-row-font)",
					}}
				/>
			</span>
		</div>
	);
}

/** Upstream `y4`: a two-line described row, a title bar over a shorter, always silent description bar. */
function DescribedPlaceholderRow({index, silent}: {index: number; silent: boolean})
{
	return (
		<div
			data-row=""
			data-described=""
			className="df-described-row flex flex-col items-stretch justify-center px-[var(--sb-row-px)]"
		>
			<span className="df-described-title flex min-w-0 items-center">
				<Skeleton
					as="span"
					silent={silent}
					className="h-[1em] rounded"
					style={
					{
						width: barWidth(index),
						height: "var(--sb-row-font)",
					}}
				/>
			</span>
			<span className="df-row-description flex min-w-0 items-center">
				<Skeleton
					as="span"
					silent
					className="h-[1em] rounded"
					style={
					{
						width: barWidth(index + 1),
						height: "var(--sb-group-font)",
					}}
				/>
			</span>
		</div>
	);
}
