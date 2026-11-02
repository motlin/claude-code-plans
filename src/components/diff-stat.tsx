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
