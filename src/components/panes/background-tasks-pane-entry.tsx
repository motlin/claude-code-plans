import {useEffect} from "react";

import type {BackgroundTaskGroups} from "../../lib/background-tasks";
import {BackgroundTasksList} from "./background-tasks-pane";
import {registerPane} from "./pane-registry";

/** Registers the `background-tasks` pane kind for this session while mounted. */
export function useRegisterBackgroundTasksPane(
	sessionId: string,
	groups: BackgroundTaskGroups,
	subagentCount: number,
): void {
	useEffect(
		() =>
			registerPane("background-tasks", {
				title: "Background tasks",
				render: () => (
					<BackgroundTasksList
						key={sessionId}
						groups={groups}
						sessionId={sessionId}
						subagents={{sessionId, count: subagentCount}}
					/>
				),
			}),
		[sessionId, groups, subagentCount],
	);
}
