import {useEffect, useMemo} from "react";

import type {BackgroundTaskStop} from "../../hooks/use-background-task-stop";
import type {SessionWorkflowRun} from "../../lib/api/session-workflow-runs";
import {type BackgroundTaskGroups, runningDismissedIds, withoutDismissed} from "../../lib/background-tasks";
import {undismissTasks, useDismissedTasks} from "../../lib/dismissed-tasks";
import {ClearFinishedTasksButton} from "./background-tasks-header-actions";
import {deferredPane} from "./deferred-pane";
import {registerPane} from "./pane-registry";

const DeferredBackgroundTasksList = deferredPane("Background tasks", async () =>
	import("./background-tasks-pane").then((module) => module.BackgroundTasksList),
);

/** Downloads the Background tasks pane renderer ahead of its first show. */
export const preloadBackgroundTasksPane = DeferredBackgroundTasksList.preload;

/**
 * Upstream `qL` + `XL`'s prune: the session's task groups without the ones "Clear finished tasks" dismissed, and a
 * dismissed task that runs again un-dismisses itself. Both the pane and the rail read these.
 */
export function useVisibleBackgroundTasks(sessionId: string, groups: BackgroundTaskGroups): BackgroundTaskGroups
{
	const dismissed = useDismissedTasks(sessionId);
	useEffect(() =>
	{
		const rerun = runningDismissedIds(groups, dismissed);
		if (rerun.length > 0) undismissTasks(sessionId, rerun);
	}, [groups, dismissed, sessionId]);
	return useMemo(() => withoutDismissed(groups, dismissed), [groups, dismissed]);
}

/** Registers the `background-tasks` pane kind for this session while mounted. */
export function useRegisterBackgroundTasksPane(
	sessionId: string,
	groups: BackgroundTaskGroups,
	subagentCount: number,
	workflowRuns?: readonly SessionWorkflowRun[],
	stop: BackgroundTaskStop | null = null,
): void
{
	useEffect(
		() =>
			registerPane(
				"background-tasks",
				{
					title: "Background tasks",
					resetKey: sessionId,
					ownsScroll: true,
					headerActions: <ClearFinishedTasksButton sessionId={sessionId} groups={groups} />,
					render: () => (
						<DeferredBackgroundTasksList
							key={sessionId}
							resetKey={sessionId}
							props={
							{
								groups,
								sessionId,
								stop,
								subagents:
								{
									sessionId,
									count: subagentCount,
								},
								...(workflowRuns === undefined
									? null
									:
										{
											workflowRuns,
										}),
							}}
						/>
					),
				},
			),
		[sessionId, groups, subagentCount, workflowRuns, stop],
	);
}
