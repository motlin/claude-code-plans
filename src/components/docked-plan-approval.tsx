import {APPROVAL_CARD_TITLE} from "./approval-card";
import {OpenPlanLink} from "./open-plan-link";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {PlanApprovalCard} from "./plan-approval-card";
import type {PlanApprovalContextValue} from "./plan-approval-context";
import {PLAN_PROPOSED_TITLE} from "../lib/exit-plan-mode";
import type {PendingPlan} from "../lib/hook-events";

/**
 * Upstream's docked plan approval for a pending ExitPlanMode whose tool_use is
 * not on disk yet: "Claude proposed a plan", its "Open plan" TextLink,
 * and the approve / revise actions, typed into the CLI's plan dialog. Like
 * upstream's card it omits the plan text; the Plan pane shows the hook plan
 * (`withPendingPlan`).
 */
export function DockedPlanApproval({pendingPlan, plan}: {pendingPlan: PendingPlan; plan: PlanApprovalContextValue}) {
	const host = useOptionalPaneHost();
	return (
		<div
			data-docked-plan=""
			data-approval-card-root=""
			tabIndex={-1}
			className="@container relative flex flex-col gap-2 rounded-r7 bg-surface-popover p-3 text-[13px]/[19px] text-primary shadow-[var(--approval-card-shadow)]"
		>
			<div className="flex items-center justify-between gap-2">
				<span className={APPROVAL_CARD_TITLE}>{PLAN_PROPOSED_TITLE}</span>
				{host && (
					<span className="shrink-0 self-center">
						<OpenPlanLink
							onOpen={() => {
								host.openPane("plan");
							}}
						/>
					</span>
				)}
			</div>
			<PlanApprovalCard toolUseId={pendingPlan.toolUseId} plan={plan} />
		</div>
	);
}
