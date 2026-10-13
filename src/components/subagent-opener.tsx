import {type ReactNode, useCallback} from "react";

import {requestSubagentFocus} from "../lib/subagent-focus-requests";
import {usePaneHost} from "./panes/pane-host-context";
import {SubagentOpenerProvider} from "./subagent-opener-context";

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
