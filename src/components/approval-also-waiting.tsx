import {useId} from "react";

import type {ApprovalPresentation} from "../lib/approval-presentation";
import type {QueuedApproval} from "../lib/approval-queue";
import {runningToolLabel, runningToolLabelText} from "../lib/tool-labels";
import {CARET_MOTION, LABEL_CLIP, ROW_CLASS, TOGGLE_STRETCHED} from "./thinking-step";
import {CARET_STYLE, TURN_STATUS_ROW_STYLE} from "./turn-status-row-geometry";
import {Icon} from "./ui/icon";

/**
 * A queued request's row label: a tool's (or question's) running label as its approval wait words it, else its name.
 */
function rowLabel(item: QueuedApproval): string
{
	if (item.kind === "elicitation" || item.kind === "plan") return item.name;
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

/** Upstream's queued row: a closed, blocked TurnStatusStep reading its label and "Needs approval". */
function QueuedStep({item}: {item: QueuedApproval})
{
	const id = useId();
	const label = rowLabel(item);
	return (
		<div
			data-approval-queued=""
			data-closed=""
			data-cds="TurnStatusStep"
			data-state="blocked"
			className="flex w-full min-w-0 flex-col [--cds-text-wrap-style:auto]"
		>
			<div
				data-cds-row=""
				data-cds-row-title={label}
				data-cds-row-title-when-cut="label"
				className={`${ROW_CLASS} items-center relative isolate rounded select-none`}
				style={TURN_STATUS_ROW_STYLE}
			>
				<span className="flex min-w-0 gap-xs items-center">
					<span id={`${id}-label`} dir="auto" className={`${LABEL_CLIP} text-primary`}>
						{label}
					</span>
				</span>
				<span id={`${id}-outcome`} className="shrink-0 text-body text-secondary">
					Needs approval
				</span>
				<button
					type="button"
					data-cds-row-toggle=""
					data-cds-row-toggle-stretched=""
					aria-expanded="false"
					aria-labelledby={`${id}-label ${id}-outcome`}
					className={TOGGLE_STRETCHED}
				>
					<span aria-hidden="true" className="inline-flex h-[1lh] items-center justify-center text-secondary">
						<Icon
							name="CaretDownSmall"
							customSize={12}
							style={CARET_STYLE}
							className={`${CARET_MOTION} -rotate-90 page-rtl:rotate-90`}
						/>
					</span>
				</button>
			</div>
		</div>
	);
}

/**
 * Upstream's "Also waiting" list (c390f938b `ui`): under the inline head card, the requests queued behind it, oldest
 * first, each as a collapsed blocked step row. The dock draws them as ghosts behind its card instead.
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
			<div className="flex flex-col w-full">
				{queued.map((item) => (
					<QueuedStep key={item.id} item={item} />
				))}
			</div>
		</div>
	);
}
