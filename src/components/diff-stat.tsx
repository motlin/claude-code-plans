import {useCountTween} from "../hooks/use-count-tween";
import {pluralize} from "../lib/pluralize";

const numberFormat = new Intl.NumberFormat("en-US");
const unitList = new Intl.ListFormat(
	"en-US",
	{
		type: "unit",
	},
);

function srCounts(added: number, removed: number): string
{
	return unitList.format([
		`${numberFormat.format(added)} ${pluralize(added, "addition")}`,
		`${numberFormat.format(removed)} ${pluralize(removed, "deletion")}`,
	]);
}

interface DiffStatProps
{
	added: number;
	removed: number;
	className?: string | undefined;
}

/**
 * Upstream's `et`: the sr-only line reads the real counts; the visible "+n −n" (grouped, U+2212) is hidden from the
 * a11y tree and may show tweened numbers. Its order is pinned left-to-right.
 */
function DiffStatView({
	added,
	removed,
	shownAdded,
	shownRemoved,
	className,
}: DiffStatProps &
{
	shownAdded: number;
	shownRemoved: number;
})
{
	return (
		<span dir="ltr" className={className === undefined ? "tabular-nums" : `tabular-nums ${className}`}>
			<span className="sr-only">{srCounts(added, removed)}</span>
			<span aria-hidden="true" className="contents">
				<span className="text-git-added">+{numberFormat.format(shownAdded)}</span>
				<span className="text-git-removed">−{numberFormat.format(shownRemoved)}</span>
			</span>
		</span>
	);
}

/** Upstream's static `$e`: settled stats (turn changes card, settled tool rows). */
export function DiffStat({added, removed, className}: DiffStatProps)
{
	return (
		<DiffStatView added={added} removed={removed} shownAdded={added} shownRemoved={removed} className={className} />
	);
}

/** Upstream's `Qe`: live stats whose visible digits ease to each new count (two independent tweens). */
export function AnimatedDiffStat({added, removed, className}: DiffStatProps)
{
	const shownAdded = useCountTween(added);
	const shownRemoved = useCountTween(removed);
	return (
		<DiffStatView
			added={added}
			removed={removed}
			shownAdded={shownAdded}
			shownRemoved={shownRemoved}
			className={className}
		/>
	);
}

/**
 * Upstream's `b7` in its subtle tone (the "Pull requests" card entries): raw digits, U+2212, no sr line and no
 * tabular-nums (the caller's wrapper adds that). The bold tone (`font-medium text-git-added` / `ms-1
 * text-git-closed`) has only cloud Projects callers, so it is left out.
 */
export function PrDiffStat({additions, deletions}: {additions: number; deletions: number})
{
	return (
		<span dir="ltr">
			<span className="text-git-added opacity-70">{`+${additions}`}</span>
			<span className="ms-1 text-git-removed opacity-70">{`−${deletions}`}</span>
		</span>
	);
}

/** Upstream cds DiffIndicator `Dh`: the text variant's base classes. */
const DIFF_INDICATOR_TEXT_CLASS =
	"inline-flex items-center gap-xs shrink-0 text-caption leading-[round(1.25em,1px)] font-sans font-medium [font-variant-numeric:tabular-nums_lining-nums] rounded-chip border-0 p-0";

/**
 * Upstream cds DiffIndicator `variant:"text"` (`Rh` → `Oh`): only the non-zero sides are drawn ("+52", no "−0"),
 * U+2212 for the minus, with the counts spelled out for screen readers. Nothing when both are 0.
 */
export function DiffIndicatorText({
	additions,
	deletions,
	label,
}: {
	additions: number;
	deletions: number;
	label?: string | undefined;
})
{
	if (additions === 0 && deletions === 0) return null;
	return (
		<span
			data-cds="DiffIndicator"
			data-size="xs"
			data-variant="text"
			dir="ltr"
			className={DIFF_INDICATOR_TEXT_CLASS}
		>
			{additions > 0 && (
				<span aria-hidden="true" className="text-git-added">
					+{additions}
				</span>
			)}
			{deletions > 0 && (
				<span aria-hidden="true" className="text-git-removed">
					−{deletions}
				</span>
			)}
			<span className="sr-only">{label ?? `${additions} added, ${deletions} removed`}</span>
		</span>
	);
}
