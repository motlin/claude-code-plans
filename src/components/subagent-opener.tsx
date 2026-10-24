import {type ReactNode, useCallback, useMemo} from "react";

import {requestBackgroundTaskFocus, setFinishedExpanded} from "../lib/background-task-focus";
import {requestSubagentFocus} from "../lib/subagent-focus-requests";
import {usePaneHost} from "./panes/pane-host-context";
import {SubagentOpenerProvider} from "./subagent-opener-context";
import {type BackgroundTasksFocus, BackgroundTasksOpenerProvider} from "./background-tasks-opener-context";

/** Lets a session page's Agent rows open the `subagents` pane focused on their agent. */
export function SessionSubagentOpener({sessionId, children}: {sessionId: string; children: ReactNode}) {
	const {openPane} = usePaneHost();
	const open = useCallback(
		(agentId: string) => {
			requestSubagentFocus(sessionId, agentId);
			openPane("subagents");
		},
		[sessionId, openPane],
	);
	return <SubagentOpenerProvider value={open}>{children}</SubagentOpenerProvider>;
}

/**
 * Lets a session page's background task rows open the `background-tasks` pane,
 * in the order of upstream's `openTask`: expand Finished, then open an agent's
 * transcript, else focus the task, else just open the pane.
 */
export function SessionBackgroundTasksOpener({
	sessionId,
	running,
	children,
}: {
	sessionId: string;
	running: ReadonlySet<string>;
	children: ReactNode;
}) {
	const {openPane} = usePaneHost();
	const value = useMemo(
		() => ({
			open: (focus?: BackgroundTasksFocus) => {
				const finished = focus?.finished === true;
				if (finished) setFinishedExpanded(sessionId, true);
				if (focus?.agentId === undefined) {
					if (focus?.taskId !== undefined) {
						requestBackgroundTaskFocus(sessionId, {taskId: focus.taskId, finished});
					}
					openPane("background-tasks");
				} else {
					requestSubagentFocus(sessionId, focus.agentId);
					openPane("subagents");
				}
			},
			running,
		}),
		[sessionId, openPane, running],
	);
	return <BackgroundTasksOpenerProvider value={value}>{children}</BackgroundTasksOpenerProvider>;
}
