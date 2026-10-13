import {useId, useState} from "react";
import type {AgentMessage} from "../lib/agent-message";
import {ProseMarkdown} from "./file-refs";
import {ChevronIcon} from "./tool-renderers/shared";
import {TruncatedContent} from "./truncated-content";

/**
 * Upstream's "Message from subagent" row for a subagent hand-back: no bubble,
 * drawn like its sibling status rows (muted label, 12px chevron), revealing the
 * report as clamped markdown prose. Upstream names a hand-back's sender
 * "subagent", never its description.
 */
export function AgentMessageRow({message}: {message: AgentMessage}) {
	const [expanded, setExpanded] = useState(false);
	const bodyId = useId();

	return (
		<div className="flex w-full min-w-0 flex-col" data-agent-message-from={message.from}>
			<button
				type="button"
				aria-expanded={expanded}
				aria-controls={bodyId}
				aria-label={expanded ? "Hide message from subagent" : "Show message from subagent"}
				onClick={() => {
					setExpanded((value) => !value);
				}}
				className="group/step flex self-stretch min-w-0 me-[52px] items-center gap-g5 px-1 py-0.5 text-left cursor-pointer outline-none hide-focus-ring focus:ring-focus rounded-r3"
			>
				<span className="shrink-0 text-body text-ink-muted group-hover/step:text-secondary">Message from</span>
				<bdi className="min-w-0 truncate text-body text-primary">subagent</bdi>
				<span className="shrink-0 -ms-1 text-ink-muted group-hover/step:text-secondary">
					<ChevronIcon expanded={expanded} size={12} />
				</span>
			</button>
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
