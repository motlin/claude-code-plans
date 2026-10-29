import {useQuery} from "@tanstack/react-query";
import {Link} from "@tanstack/react-router";
import {Check, Copy, FileText} from "lucide-react";
import {useEffect, useRef, useState} from "react";

import {planQueryOptions} from "../../lib/api/plans";
import {writeClipboardText} from "../../lib/clipboard";
import {PLAN_FILE_ACTION_LABEL} from "../../lib/exit-plan-mode";
import {toMdSlug} from "../../lib/md-slug";
import type {SessionPlanModel} from "../../lib/session-plan-model";
import {Tooltip} from "../ui/tooltip";
import {PANE_HEADER_ICON_BUTTON_CLASS} from "./pane-classes";
import {registerPane, type PaneDefinition} from "./pane-registry";
import {SessionPlanPane} from "./plan-pane";

/** What the Plan pane needs from the session page beyond the plan itself. */
export interface PlanPaneOptions {
	sessionId: string;
	/** Upstream's flag: the session is in plan mode or has a plan waiting for approval. */
	commentsEnabled: boolean;
}

/** How long upstream's Copy plan button shows "Copied" with a check. */
const COPIED_MS = 1500;

/** Whether the session has anything for upstream's Plan pane: a linked plan, plan text, a plan-file edit or todos. */
export function hasSessionPlan(planFilename: string | undefined, model: SessionPlanModel): boolean {
	return planFilename !== undefined || model.content !== null || model.editsPlanFile || model.todos.length > 0;
}

/**
 * Upstream's ghost "Copy plan" icon button, which copies the plan markdown and turns into
 * "Copied" with a check for a moment. Upstream draws it only while the plan has text.
 */
function CopyPlanButton({content}: {content: string}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () => {
			clearTimeout(timer.current);
		},
		[],
	);
	const label = copied ? "Copied" : "Copy plan";
	const Icon = copied ? Check : Copy;
	return (
		<Tooltip content={label}>
			<button
				type="button"
				aria-label={label}
				className={PANE_HEADER_ICON_BUTTON_CLASS}
				onMouseDown={(event) => {
					event.preventDefault();
				}}
				onClick={() => {
					void writeClipboardText(content).then((ok) => {
						if (!ok) return;
						setCopied(true);
						clearTimeout(timer.current);
						timer.current = setTimeout(() => {
							setCopied(false);
						}, COPIED_MS);
					});
				}}
			>
				<Icon aria-hidden="true" className="h-4 w-4" />
			</button>
		</Tooltip>
	);
}

function OpenPlanFileLink({planFilename}: {planFilename: string}) {
	return (
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

/** A linked plan's header: the local plan-file link in upstream's "Open in" slot, then Copy plan for the file's text. */
function LinkedPlanHeaderActions({planFilename, model}: {planFilename: string; model: SessionPlanModel}) {
	const {data: plan} = useQuery(planQueryOptions(toMdSlug(planFilename)));
	const content = plan?.markdown ?? model.content;
	return (
		<>
			<OpenPlanFileLink planFilename={planFilename} />
			{content !== null && content !== "" && <CopyPlanButton content={content} />}
		</>
	);
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
