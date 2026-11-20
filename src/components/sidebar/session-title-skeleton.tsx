import {Skeleton} from "../ui/skeleton";

const TITLE_BAR_STYLE =
{
	width: "28ch",
	height: "var(--sb-row-font, 13px)",
} as const;

/**
 * Upstream `RM`: a launching row's title before it has one, a 28ch decorative bar one row-font tall beside a single
 * sr-only "Loading" status.
 */
export function SessionTitleSkeleton()
{
	return (
		<span className="inline-flex h-[1lh] items-center align-top">
			<Skeleton as="span" silent className="h-[1em] rounded" style={TITLE_BAR_STYLE} />
			<span role="status" className="sr-only">
				Loading
			</span>
		</span>
	);
}
