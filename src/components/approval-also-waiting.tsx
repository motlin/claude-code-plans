import type {ApprovalPresentation} from "../lib/approval-presentation";
import type {QueuedApproval} from "../lib/approval-queue";
import {runningToolLabel, runningToolLabelText} from "../lib/tool-labels";

/** A queued request's row label: a tool's running label as its approval wait words it, else its name. */
function rowLabel(item: QueuedApproval): string
{
	if (item.kind !== "tool") return item.name;
	return runningToolLabelText(
		runningToolLabel(
			{
				name: item.name,
				input: item.input ?? {},
				awaitingApproval: true,
			},
		),
	);
}

/**
 * Upstream's "Also waiting" list (c390f938b `ui`): under the inline head card, the requests queued behind it, oldest
 * first, each as a collapsed pending row. The dock draws them as ghosts behind its card instead.
 */
export function ApprovalAlsoWaiting({
	queued,
	presentation,
}: {
	queued: readonly QueuedApproval[];
	presentation: ApprovalPresentation;
})
{
	if (presentation === "dock" || queued.length === 0) return null;
	return (
		<div className="flex flex-col gap-[var(--chat-item-gap)]">
			<div className="text-footnote text-muted-as-secondary">Also waiting</div>
			{queued.map((item) => (
				<div
					key={item.id}
					data-approval-queued=""
					className="flex min-w-0 items-center gap-sm text-body text-secondary"
				>
					<span className="min-w-0 truncate">{rowLabel(item)}</span>
				</div>
			))}
		</div>
	);
}
