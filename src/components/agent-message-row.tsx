import {createContext, useContext, useId, useState} from "react";
import type {AgentMessage} from "../lib/agent-message";
import {ProseMarkdown} from "./file-refs";
import {ChevronIcon} from "./tool-renderers/shared";
import {TruncatedContent} from "./truncated-content";

/** Resolves a bare agent id to the subagent's description, or null when the session does not know it. */
export type AgentNameResolver = (agentId: string) => string | null;

export const AgentNameContext = createContext<AgentNameResolver>(() => null);

/**
 * Upstream's "Message from <sender>" human row for a subagent hand-back: no
 * bubble, a ghost chevron that reveals the report as clamped markdown prose.
 */
export function AgentMessageRow({message}: {message: AgentMessage}) {
	const sender = useContext(AgentNameContext)(message.from) ?? "subagent";
	const [expanded, setExpanded] = useState(false);
	const bodyId = useId();

	return (
		<div className="group/tool flex w-full min-w-0 flex-col" data-agent-message-from={message.from}>
			<div className="flex min-w-0 items-center gap-1 text-body text-secondary">
				<span className="shrink-0">Message from</span>
				<bdi className="min-w-0 truncate text-primary">{sender}</bdi>
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls={bodyId}
					aria-label={expanded ? "Hide message from subagent" : "Show message from subagent"}
					onClick={() => setExpanded((value) => !value)}
					className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-r4 text-primary transition-colors hover:bg-alpha-1"
				>
					<ChevronIcon expanded={expanded} size={14} />
				</button>
			</div>
			{expanded && (
				<div id={bodyId} className="pt-p6 text-body text-primary select-text">
					<TruncatedContent>
						<ProseMarkdown markdown={message.body} />
					</TruncatedContent>
				</div>
			)}
		</div>
	);
}
