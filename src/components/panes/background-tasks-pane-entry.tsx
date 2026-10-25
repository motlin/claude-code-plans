import {useEffect} from "react";

import type {SessionWorkflowRun} from "../../lib/api/session-workflow-runs";
import type {BackgroundTaskGroups} from "../../lib/background-tasks";
import {deferredPane} from "./deferred-pane";
import {registerPane} from "./pane-registry";

const DeferredBackgroundTasksList = deferredPane("Background tasks", async () =>
	import("./background-tasks-pane").then((module) => module.BackgroundTasksList),
);

/** Downloads the Background tasks pane renderer ahead of its first show. */
export const preloadBackgroundTasksPane = DeferredBackgroundTasksList.preload;

/** Registers the `background-tasks` pane kind for this session while mounted. */
export function useRegisterBackgroundTasksPane(
	sessionId: string,
	groups: BackgroundTaskGroups,
	subagentCount: number,
	workflowRuns?: readonly SessionWorkflowRun[],
): void {
	useEffect(
		() =>
			registerPane("background-tasks", {
				title: "Background tasks",
				render: () => (
					<DeferredBackgroundTasksList
						key={sessionId}
						resetKey={sessionId}
						props={{
							groups,
							sessionId,
							subagents: {sessionId, count: subagentCount},
							...(workflowRuns === undefined ? null : {workflowRuns}),
						}}
					/>
				),
			}),
		[sessionId, groups, subagentCount, workflowRuns],
	);
}
