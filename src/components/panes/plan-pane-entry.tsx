import {useEffect} from "react";

import type {SessionPlanModel} from "../../lib/session-plan-model";
import {registerPane} from "./pane-registry";
import {SessionPlanPane} from "./plan-pane";

/** Whether the session has anything for upstream's Plan pane: a linked plan, plan text, a plan-file edit or todos. */
export function hasSessionPlan(planFilename: string | undefined, model: SessionPlanModel): boolean {
	return planFilename !== undefined || model.content !== null || model.editsPlanFile || model.todos.length > 0;
}

/** Registers the `plan` pane kind while the session has a linked plan, ExitPlanMode plan text or todos. */
export function useRegisterPlanPane(planFilename: string | undefined, model: SessionPlanModel): void {
	const available = hasSessionPlan(planFilename, model);
	useEffect(() => {
		if (!available) return undefined;
		return registerPane("plan", {
			title: "Plan",
			render: () => <SessionPlanPane key={planFilename ?? ""} planFilename={planFilename} model={model} />,
		});
	}, [available, planFilename, model]);
}
