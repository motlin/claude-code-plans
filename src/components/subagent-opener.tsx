import {type ReactNode, useCallback, useMemo} from "react";

import {requestSubagentFocus} from "../lib/subagent-focus-requests";
import {usePaneHost} from "./panes/pane-host-context";
import {SubagentOpenerProvider} from "./subagent-opener-context";
import {BackgroundTasksOpenerProvider} from "./background-tasks-opener-context";

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

/** Lets a session page's running background command rows open the `background-tasks` pane. */
export function SessionBackgroundTasksOpener({running, children}: {running: ReadonlySet<string>; children: ReactNode}) {
	const {openPane} = usePaneHost();
	const value = useMemo(
		() => ({
			open: () => {
				openPane("background-tasks");
			},
			running,
		}),
		[openPane, running],
	);
	return <BackgroundTasksOpenerProvider value={value}>{children}</BackgroundTasksOpenerProvider>;
}
