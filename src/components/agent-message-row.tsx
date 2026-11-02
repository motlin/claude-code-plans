import {useId, useState} from "react";
import {useTypeRowCut} from "../lib/use-row-cut";
import type {AgentMessage} from "../lib/agent-message";
import {ProseMarkdown} from "./file-refs";
import {ChevronIcon} from "./tool-renderers/shared";
import {TruncatedContent} from "./truncated-content";
import {TURN_STATUS_ROW_GEOMETRY, TURN_STATUS_ROW_STYLE} from "./turn-status-row-geometry";

/**
 * Upstream's "Message from subagent" row for a subagent hand-back: no bubble,
 * drawn like its sibling status rows (muted label, 12px chevron), revealing the
 * report as clamped markdown prose. Upstream names a hand-back's sender
 * "subagent", never its description.
 */
export function AgentMessageRow({message}: {message: AgentMessage})
{
	const [expanded, setExpanded] = useState(false);
	const bodyId = useId();
	const rowCut = useTypeRowCut("Message from\nsubagent");

	return (
		<div className="flex w-full min-w-0 flex-col" data-agent-message-from={message.from}>
			<button
				type="button"
				aria-expanded={expanded}
				aria-controls={bodyId}
				aria-label={expanded ? "Hide message from subagent" : "Show message from subagent"}
				onClick={() =>
				{
					setExpanded((value) => !value);
				}}
				data-cds-row=""
				className={`group/step flex min-w-0 ${TURN_STATUS_ROW_GEOMETRY} py-0.5 items-center gap-g5 text-left cursor-pointer outline-none hide-focus-ring focus-visible:ring-focus rounded-r3`}
				style={TURN_STATUS_ROW_STYLE}
			>
				<span className="shrink-0 text-body text-ink-muted group-hover/step:text-secondary">Message from</span>
				<bdi ref={rowCut} className="min-w-0 truncate text-body text-primary">
					subagent
				</bdi>
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
