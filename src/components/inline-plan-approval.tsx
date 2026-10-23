import {ApprovalCardShell} from "./approval-card";
import {OpenPlanLink} from "./open-plan-link";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {PlanApprovalCard} from "./plan-approval-card";
import type {PlanApprovalContextValue} from "./plan-approval-context";
import {PLAN_PROPOSED_TITLE} from "../lib/exit-plan-mode";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";

/**
 * Upstream's plan approval card for an on-disk ExitPlanMode the session waits on:
 * its own approval card in the transcript's sticky trailing slot, the title row
 * "Claude proposed a plan" with its "Open plan" action, then the approve / revise
 * actions typed into the CLI's plan dialog. The plan text stays in the tool row.
 */
export function InlinePlanApproval({toolUseId, plan}: {toolUseId: string; plan: PlanApprovalContextValue}) {
	const host = useOptionalPaneHost();
	return (
		<div data-inline-plan="" className={`${CHAT_COLUMN_CLASS} sticky top-[5px] z-[1] bg-surface-1 pb-4`}>
			<ApprovalCardShell
				presentation="card"
				body={
					<div className="flex min-h-6 items-center gap-1 text-primary">
						<span className="font-[580]">{PLAN_PROPOSED_TITLE}</span>
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
				}
				actions={
					<div className="w-full">
						<PlanApprovalCard toolUseId={toolUseId} plan={plan} />
					</div>
				}
			/>
		</div>
	);
}
