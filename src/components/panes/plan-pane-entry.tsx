import {useEffect} from "react";

import type {SessionPlanModel} from "../../lib/session-plan-model";
import {registerPane, type PaneDefinition} from "./pane-registry";
import {CopyPlanButton, LinkedPlanHeaderActions} from "./plan-header-actions";
import {SessionPlanPane} from "./plan-pane";

/** What the Plan pane needs from the session page beyond the plan itself. */
export interface PlanPaneOptions {
	sessionId: string;
	/** Upstream's flag: the session is in plan mode or has a plan waiting for approval. */
	commentsEnabled: boolean;
}

/** Whether the session has anything for upstream's Plan pane: a linked plan, plan text, a plan-file edit or todos. */
export function hasSessionPlan(planFilename: string | undefined, model: SessionPlanModel): boolean {
	return planFilename !== undefined || model.content !== null || model.editsPlanFile || model.todos.length > 0;
}

/**
 * The `plan` pane: upstream's "Plan" header and body. The header carries upstream's "Copy plan"
 * for the shown plan text, led by a local "Open plan file" link to the plan's page when the
 * session links a `~/.claude/plans` file (where upstream puts its "Open in" menu).
 */
export function planPaneDefinition(
	planFilename: string | undefined,
	model: SessionPlanModel,
	{sessionId, commentsEnabled}: PlanPaneOptions,
): PaneDefinition {
	const definition: PaneDefinition = {
		title: "Plan",
		render: () => (
			<SessionPlanPane
				key={`${sessionId}:${planFilename ?? ""}`}
				sessionId={sessionId}
				planFilename={planFilename}
				model={model}
				commentsEnabled={commentsEnabled}
			/>
		),
	};
	if (planFilename !== undefined) {
		definition.headerActions = <LinkedPlanHeaderActions planFilename={planFilename} model={model} />;
	} else if (model.content !== null && model.content !== "") {
		definition.headerActions = <CopyPlanButton content={model.content} />;
	}
	return definition;
}

/**
 * Registers the `plan` pane kind for every session, as upstream does: View options lists Plan only
 * when the session has one (or the pane is already open), and an open pane without a plan shows
 * "No plan yet".
 */
export function useRegisterPlanPane(
	planFilename: string | undefined,
	model: SessionPlanModel,
	{sessionId, commentsEnabled}: PlanPaneOptions,
): void {
	useEffect(
		() => registerPane("plan", planPaneDefinition(planFilename, model, {sessionId, commentsEnabled})),
		[planFilename, model, sessionId, commentsEnabled],
	);
}
