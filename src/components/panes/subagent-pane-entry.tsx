import {useEffect, useMemo} from "react";

import {extractAgentPrompts, type Subagent} from "../../lib/subagents";
import {registerPane} from "./pane-registry";
import {SubagentPane} from "./subagent-pane";

interface SubagentPaneRegistration {
	sessionId: string;
	subagents: readonly Subagent[];
	/** The parent transcript window, whose `Agent` calls carry each subagent's prompt. */
	records: Parameters<typeof extractAgentPrompts>[0];
}

/** Registers the `subagents` pane kind (View options ▸ Subagents) while mounted. */
export function useRegisterSubagentPane({sessionId, subagents, records}: SubagentPaneRegistration): void {
	const prompts = useMemo(() => extractAgentPrompts(records), [records]);
	useEffect(
		() =>
			registerPane("subagents", {
				title: "Subagents",
				header: "custom",
				render: (chrome) => (
					<SubagentPane sessionId={sessionId} subagents={subagents} prompts={prompts} chrome={chrome} />
				),
			}),
		[sessionId, subagents, prompts],
	);
}
