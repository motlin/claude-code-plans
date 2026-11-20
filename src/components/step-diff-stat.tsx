import {requestChangesScope} from "../lib/changes-scope-request";
import {DiffIndicatorText} from "./diff-stat";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {Tooltip} from "./ui/tooltip";

/** Upstream's trailing-fact seat on a TurnStatus header. */
const SEAT_CLASS = "inline-flex h-[1lh] min-w-0 shrink-0 items-center overflow-visible text-secondary tabular-nums";

/** Upstream `kpe`'s hover/focus underline: an `::after` border, resting at 65% on touch. */
const UNDERLINE_CLASS =
	"relative flex after:absolute after:inset-x-0 after:bottom-px after:border-b after:border-transparent group-hover/changes:after:border-current group-focus-visible/changes:after:border-current touch:after:border-current/65";

/**
 * Upstream `Epe`: a step header's trailing diff stat. On a settled step (`mayLink`) inside the pane host it is the
 * "View changes" TextLink (`kpe`), which opens the Changes pane scoped to the step's turn; otherwise the plain text
 * DiffIndicator (`m1`). The link stops its click and Enter/Space so they don't also toggle the row.
 */
export function StepDiffStat({
	added,
	removed,
	sessionId,
	turnUuid,
	mayLink,
}: {
	added: number;
	removed: number;
	sessionId: string;
	/** Any uuid inside the step's turn, for the Changes pane's `turn:<uuid>` scope. */
	turnUuid: string;
	mayLink: boolean;
})
{
	const host = useOptionalPaneHost();
	const stat = <DiffIndicatorText additions={added} deletions={removed} />;
	if (!mayLink || host === null) return <span className={SEAT_CLASS}>{stat}</span>;
	const open = () =>
	{
		requestChangesScope(sessionId, `turn:${turnUuid}`);
		host.openPane("changes");
	};
	return (
		<span className={SEAT_CLASS}>
			<Tooltip content="View changes">
				<span
					role="button"
					tabIndex={0}
					data-transcript-keeps-pin=""
					aria-label={`View changes, ${added} added, ${removed} removed`}
					title=""
					className="cursor-pointer group/changes no-underline rounded-xs text-inherit focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus"
					onClick={(event) =>
					{
						event.stopPropagation();
						open();
					}}
					onKeyDown={(event) =>
					{
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						event.stopPropagation();
						open();
					}}
				>
					<span className={UNDERLINE_CLASS}>{stat}</span>
				</span>
			</Tooltip>
		</span>
	);
}
