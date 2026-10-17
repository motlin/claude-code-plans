import {useEffect} from "react";

import type {SessionPlanModel} from "../../lib/session-plan-model";
import {registerPane} from "./pane-registry";
import {SessionPlanPane} from "./plan-pane";

/** Whether the session has anything for upstream's Plan pane: a linked plan, plan text, a plan-file edit or todos. */
export function hasSessionPlan(planFilename: string | undefined, model: SessionPlanModel): boolean {
	return planFilename !== undefined || model.content !== null || model.editsPlanFile || model.todos.length > 0;
}

/**
 * Registers the `plan` pane kind for every session, as upstream does: View options lists Plan only
 * when the session has one (or the pane is already open), and an open pane without a plan shows
 * "No plan yet".
 */
export function useRegisterPlanPane(planFilename: string | undefined, model: SessionPlanModel): void {
	useEffect(
		() =>
			registerPane("plan", {
				title: "Plan",
				render: () => <SessionPlanPane key={planFilename ?? ""} planFilename={planFilename} model={model} />,
			}),
		[planFilename, model],
	);
}
