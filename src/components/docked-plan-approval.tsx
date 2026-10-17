import {APPROVAL_CARD_TITLE} from "./approval-card";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {PlanApprovalCard} from "./plan-approval-card";
import type {PlanApprovalContextValue} from "./plan-approval-context";
import {OPEN_PLAN_ACTION_LABEL, PLAN_BLOCK_CLASS, PLAN_PROPOSED_TITLE} from "../lib/exit-plan-mode";
import type {PendingPlan} from "../lib/hook-events";

/**
 * Upstream's docked plan approval for a pending ExitPlanMode whose tool_use is
 * not on disk yet: "Claude proposed a plan", its "Open plan" footnote action,
 * the plan text in the awaiting card's left-bordered block, and the approve /
 * revise actions, typed into the CLI's plan dialog.
 */
export function DockedPlanApproval({pendingPlan, plan}: {pendingPlan: PendingPlan; plan: PlanApprovalContextValue}) {
	const host = useOptionalPaneHost();
	return (
		<div
			data-docked-plan=""
			className="flex flex-col gap-2 rounded-r7 bg-surface-popover p-3 text-[13px]/[19px] text-primary shadow-[var(--approval-card-shadow)]"
		>
			<div className="flex items-center justify-between gap-2">
				<span className={APPROVAL_CARD_TITLE}>{PLAN_PROPOSED_TITLE}</span>
				{host && (
					<button
						type="button"
						className="shrink-0 text-footnote text-secondary hover:text-primary hover:underline"
						onClick={() => {
							host.openPane("plan");
						}}
					>
						{OPEN_PLAN_ACTION_LABEL}
					</button>
				)}
			</div>
			<div data-plan-block="" className={`${PLAN_BLOCK_CLASS} max-h-[40vh] overflow-y-auto py-1.5`}>
				{pendingPlan.plan}
			</div>
			<PlanApprovalCard toolUseId={pendingPlan.toolUseId} plan={plan} />
		</div>
	);
}
