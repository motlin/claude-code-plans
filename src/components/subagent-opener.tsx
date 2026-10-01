import {createContext, type ReactNode, useCallback, useContext} from "react";

import {requestSubagentFocus} from "../lib/subagent-focus-requests";
import {usePaneHost} from "./panes/tile-host";

type SubagentOpener = (agentId: string) => void;

const SubagentOpenerContext = createContext<SubagentOpener | null>(null);

export const SubagentOpenerProvider = SubagentOpenerContext.Provider;

/** Opens the Subagent pane on an agent, or null where no pane can host it. */
export function useSubagentOpener(): SubagentOpener | null {
	return useContext(SubagentOpenerContext);
}

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
