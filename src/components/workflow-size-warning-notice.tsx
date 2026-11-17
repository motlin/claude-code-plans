import {useEffect, useState, useSyncExternalStore} from "react";

import type {WorkflowRun} from "../lib/workflow-runs";
import {pickSizeWarning, type SizeWarning, sizeTokenLabel} from "../lib/workflow-size-warning";
import
{
	getWorkflowSizeStore,
	setWorkflowSizeEntry,
	setWorkflowSizeStore,
	subscribeWorkflowSizeStore,
} from "../lib/workflow-size-store";
import {ApprovalActionButton} from "./approval-card";
import {useBackgroundTasksOpener} from "./background-tasks-opener-context";
import {useComposerNotice} from "./composer-notice-context";
import {NoticeBanner} from "./notice-banner";
import {Icon} from "./ui/icon";

/** Upstream `Eo`: whether the document is visible, tracked through `visibilitychange`. */
function useDocumentVisible(): boolean
{
	// Starts visible so server rendering never reads `document`; the effect corrects it on mount.
	const [visible, setVisible] = useState(true);
	useEffect(() =>
	{
		const update = () =>
		{
			setVisible(document.visibilityState !== "hidden");
		};
		update();
		document.addEventListener("visibilitychange", update);
		return () =>
		{
			document.removeEventListener("visibilitychange", update);
		};
	}, []);
	return visible;
}

/** Upstream `OSe`. */
function headline(name: string | null)
{
	return name === null ? (
		"This workflow is larger than most."
	) : (
		<>
			<bdi className="font-medium">{name}</bdi> is larger than most workflows.
		</>
	);
}

function agentsLabel(count: number): string
{
	return `${count} ${count === 1 ? "agent" : "agents"}`;
}

/** Upstream `xSe`: the agents axis omits tokens and the tokens axis omits agents. */
function detail(warning: SizeWarning, named: boolean): string
{
	const tail = named ? "." : ", more than most workflows use.";
	const tokens = sizeTokenLabel(warning.projectedTokens, "en-US");
	if (warning.axis === "agents") return `Up to ${agentsLabel(warning.scheduledAgents)} scheduled${tail}`;
	if (warning.axis === "tokens") return `As many as ${tokens} tokens projected${tail}`;
	return `Up to ${agentsLabel(warning.scheduledAgents)} scheduled, about ${tokens} tokens projected.`;
}

/**
 * The workflow size notice (upstream `MSe` → `ASe` → `b6`, slot `workflow`, cc43287c9-BxA0kd-D
 * 2026-11-10): while a running workflow schedules more than 25 agents or projects more than 1.5M
 * tokens, a neutral card names it and offers View. Stop is dropped (local can't stop a CLI task).
 */
export function WorkflowSizeWarningNotice({
	runs,
	refusalShown,
}: {
	runs: readonly WorkflowRun[] | undefined;
	/** Upstream `Tie`: the card yields while the refusal band shows. */
	refusalShown: boolean;
})
{
	const current = useSyncExternalStore(subscribeWorkflowSizeStore, getWorkflowSizeStore, getWorkflowSizeStore);
	const visible = useDocumentVisible();
	const opener = useBackgroundTasksOpener();
	const picked = runs === undefined ? null : pickSizeWarning(runs, current);
	const taskId = picked?.taskId;
	const warning = picked?.warning;

	// Upstream `CSe`'s effect: forget finished tasks, then remember the picked warning for the ratchet.
	useEffect(() =>
	{
		const finished = (runs ?? []).filter(
			(run) => run.status !== "running" && getWorkflowSizeStore().has(run.taskId),
		);
		if (finished.length > 0)
		{
			const next = new Map(getWorkflowSizeStore());
			for (const run of finished) next.delete(run.taskId);
			setWorkflowSizeStore(next);
		}
		if (taskId === undefined || warning === undefined) return;
		const entry = getWorkflowSizeStore().get(taskId);
		if (entry !== "dismissed" && entry?.warning !== warning)
		{
			setWorkflowSizeEntry(
				taskId,
				{
					warning,
				},
			);
		}
	}, [runs, taskId, warning]);

	const show = picked !== null && visible && !refusalShown;
	const notice = show
		?
			{
				id: picked.taskId,
				content: (
					<NoticeBanner
						icon={<Icon name="Info" size="auto" />}
						data-testid="workflow-size-card"
						onDismiss={() =>
						{
							setWorkflowSizeEntry(picked.taskId, "dismissed");
						}}
						{...(opener === null
							? {}
							:
								{
									action: (
										<div className="flex min-w-0 flex-wrap items-center gap-xs">
											<ApprovalActionButton
												variant="secondary"
												aria-label="View workflow"
												onClick={() =>
												{
													opener.open(
														{
															taskId: picked.taskId,
															finished: false,
														},
													);
												}}
											>
												View
											</ApprovalActionButton>
										</div>
									),
								})}
					>
						<span aria-atomic="true">
							<span>{headline(picked.name)}</span>{" "}
							<span className="text-muted-as-secondary">
								{detail(picked.warning, picked.name !== null)}
							</span>
						</span>
					</NoticeBanner>
				),
			}
		: null;
	const claimed = useComposerNotice("workflow", notice);
	return claimed ? null : (notice?.content ?? null);
}
