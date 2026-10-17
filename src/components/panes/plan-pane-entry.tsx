import {Link} from "@tanstack/react-router";
import {FileText} from "lucide-react";
import {useEffect} from "react";

import {PLAN_FILE_ACTION_LABEL} from "../../lib/exit-plan-mode";
import {toMdSlug} from "../../lib/md-slug";
import type {SessionPlanModel} from "../../lib/session-plan-model";
import {Tooltip} from "../ui/tooltip";
import {PANE_HEADER_ICON_BUTTON_CLASS} from "./pane-classes";
import {registerPane, type PaneDefinition} from "./pane-registry";
import {SessionPlanPane} from "./plan-pane";

/** Whether the session has anything for upstream's Plan pane: a linked plan, plan text, a plan-file edit or todos. */
export function hasSessionPlan(planFilename: string | undefined, model: SessionPlanModel): boolean {
	return planFilename !== undefined || model.content !== null || model.editsPlanFile || model.todos.length > 0;
}

/**
 * The `plan` pane: upstream's "Plan" header and body, plus a local "Open plan file" header action
 * to the plan's page when the session links a `~/.claude/plans` file.
 */
export function planPaneDefinition(planFilename: string | undefined, model: SessionPlanModel): PaneDefinition {
	const definition: PaneDefinition = {
		title: "Plan",
		render: () => <SessionPlanPane key={planFilename ?? ""} planFilename={planFilename} model={model} />,
	};
	if (planFilename !== undefined) {
		definition.headerActions = (
			<Tooltip content={PLAN_FILE_ACTION_LABEL}>
				<Link
					to="/plan/$filename"
					params={{filename: toMdSlug(planFilename)}}
					aria-label={PLAN_FILE_ACTION_LABEL}
					className={PANE_HEADER_ICON_BUTTON_CLASS}
				>
					<FileText className="h-4 w-4" />
				</Link>
			</Tooltip>
		);
	}
	return definition;
}

/**
 * Registers the `plan` pane kind for every session, as upstream does: View options lists Plan only
 * when the session has one (or the pane is already open), and an open pane without a plan shows
 * "No plan yet".
 */
export function useRegisterPlanPane(planFilename: string | undefined, model: SessionPlanModel): void {
	useEffect(() => registerPane("plan", planPaneDefinition(planFilename, model)), [planFilename, model]);
}
