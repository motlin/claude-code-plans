import {useQuery} from "@tanstack/react-query";
import {ChevronLeft} from "lucide-react";
import {useCallback, useEffect, useMemo, useState} from "react";

import {transcriptQueryOptions} from "../../lib/api/sessions";
import {formatModelName} from "../../lib/model-name";
import {loadSubagentPaneAgent, saveSubagentPaneAgent} from "../../lib/pane-layout";
import {extractAgentPrompts, type Subagent} from "../../lib/subagents";
import {processTranscript} from "../../lib/transcript";
import {SessionChat} from "../session-chat";
import {Tooltip} from "../ui/tooltip";
import {registerPane, type PaneChrome} from "./pane-registry";

const GHOST_ICON_BUTTON =
	"flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary";

/** Upstream clamps the prompt bubble at 16rem and fades its last 3rem. */
const PROMPT_CLAMP_CLASSES = "max-h-[16rem] [mask-image:linear-gradient(to_bottom,#000_calc(100%-3rem),transparent)]";

function SubagentPrompt({prompt}: {prompt: string}) {
	const [overflowing, setOverflowing] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const measureRef = useCallback((node: HTMLDivElement | null) => {
		if (node !== null) setOverflowing(node.scrollHeight > node.clientHeight);
	}, []);
	const clamped = overflowing && !expanded;

	return (
		<div className="flex flex-col items-start gap-1">
			<div
				ref={measureRef}
				data-subagent-prompt
				data-clamped={String(clamped)}
				className={`w-full overflow-hidden rounded-r7 bg-user-msg-bg px-3 py-2 text-body break-words whitespace-pre-wrap text-user-msg-text select-text ${expanded ? "" : PROMPT_CLAMP_CLASSES}`}
			>
				{prompt}
			</div>
			{clamped && (
				<button
					type="button"
					aria-expanded={false}
					onClick={() => setExpanded(true)}
					className="h-5 cursor-pointer rounded-r5 px-1.5 text-xs text-primary transition-colors hover:bg-fill-ghost-hover"
				>
					Show more
				</button>
			)}
		</div>
	);
}

function SubagentActivity({agent, hasPrompt}: {agent: Subagent; hasPrompt: boolean}) {
	const transcript = useQuery(transcriptQueryOptions(agent.id)).data;
	const processed = useMemo(
		() => (transcript === undefined ? undefined : processTranscript(transcript.records, transcript.startIndex)),
		[transcript],
	);
	if (processed === undefined) {
		return (
			<p role="status" className="text-xs text-t6">
				Loading…
			</p>
		);
	}
	// The agent JSONL opens with the prompt the bubble above already shows.
	const [first, ...rest] = processed.lines;
	const lines = hasPrompt && first?.type === "user" ? rest : processed.lines;
	if (lines.length === 0) return <p className="text-xs text-t6">No activity yet</p>;
	return (
		<SessionChat
			sessionId={agent.id}
			lines={lines}
			toolResultMap={processed.toolResultMap}
			shouldScrollToEnd={false}
		/>
	);
}

interface SubagentPaneProps {
	sessionId: string;
	subagents: readonly Subagent[];
	prompts: ReadonlyMap<string, string>;
	chrome: PaneChrome;
}

function SubagentPane({sessionId, subagents, prompts, chrome}: SubagentPaneProps) {
	const [agentId, setAgentId] = useState<string | null>(() => loadSubagentPaneAgent(sessionId));
	const focus = useCallback(
		(id: string | null) => {
			setAgentId(id);
			saveSubagentPaneAgent(sessionId, id);
		},
		[sessionId],
	);
	const agent = subagents.find((candidate) => candidate.id === agentId);
	const prompt = agent === undefined ? undefined : prompts.get(agent.id);
	const model = agent === undefined ? null : formatModelName(agent.model);

	return (
		<>
			<div data-subagent-header className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
				<div className="flex min-w-0 flex-1 items-center gap-1">
					{agent !== undefined && (
						<Tooltip content="Back">
							<button
								type="button"
								aria-label="Back"
								onClick={() => focus(null)}
								className={GHOST_ICON_BUTTON}
							>
								<ChevronLeft aria-hidden="true" className="size-4" />
							</button>
						</Tooltip>
					)}
					<h2 data-pane-title className="truncate pl-1 text-body font-normal text-secondary select-none">
						{agent === undefined ? "Subagents" : (agent.description ?? agent.id)}
					</h2>
				</div>
				{chrome.moveHandle}
				<div className="relative flex shrink-0 items-center gap-0.5">{chrome.controls}</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto rounded-b-[inherit]">
				{agent === undefined ? (
					subagents.length === 0 ? (
						<p className="px-4 py-8 text-center text-xs text-t6">No subagents in this session.</p>
					) : (
						<ul className="flex flex-col p-1">
							{subagents.map((candidate) => {
								const label = candidate.description ?? candidate.id;
								return (
									<li key={candidate.id}>
										<button
											type="button"
											aria-label={`Open subagent ${label}`}
											onClick={() => focus(candidate.id)}
											className="w-full cursor-pointer truncate rounded-r5 px-2 py-1.5 text-left text-body text-primary transition-colors hover:bg-fill-ghost-hover"
										>
											{label}
										</button>
									</li>
								);
							})}
						</ul>
					)
				) : (
					<div className="flex flex-col gap-3 px-3 pt-1 pb-4">
						{model !== null && <p className="text-xs text-t6">Model {model}</p>}
						{prompt !== undefined && <SubagentPrompt key={agent.id} prompt={prompt} />}
						<SubagentActivity agent={agent} hasPrompt={prompt !== undefined} />
					</div>
				)}
			</div>
		</>
	);
}

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
