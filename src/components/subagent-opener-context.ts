import {createContext, useContext} from "react";

type SubagentOpener = (agentId: string) => void;

const SubagentOpenerContext = createContext<SubagentOpener | null>(null);

export const SubagentOpenerProvider = SubagentOpenerContext.Provider;

/** Opens the Subagent pane on an agent, or null where no pane can host it. */
export function useSubagentOpener(): SubagentOpener | null {
	return useContext(SubagentOpenerContext);
}
