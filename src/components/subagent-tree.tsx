import {Link} from "@tanstack/react-router";
import {Bot, ChevronDown, ChevronRight} from "lucide-react";
import {useMemo, useState} from "react";
import type {Subagent} from "../lib/subagents";
import {
	buildSubagentTree,
	groupSubagentTreeByDate,
	type ParallelSubagentGroup,
	type SubagentTreeEntry,
	type SubagentTreeNode,
	type WorkflowPhaseGroup,
	type WorkflowRunGroup,
	type WorkflowRunInfo,
} from "../lib/subagent-tree";
import {phaseAriaLabel} from "../lib/workflow-phase";
import {formatDuration} from "../lib/format-duration";
import {formatModelName} from "../lib/model-name";
import {useClaudeEvents} from "../hooks/use-claude-events";
import {mergeLiveSubagents} from "../lib/live-subagent-store";
import {toSubagentSessionId} from "../lib/subagents";

const AGENT_TYPE_STYLES: Record<string, string> = {
	Explore: "bg-blue-500/15 text-blue-400",
	Plan: "bg-purple-500/15 text-purple-400",
	"build:precommit-runner": "bg-yellow-500/15 text-yellow-400",
	"git:commit-handler": "bg-green-500/15 text-green-400",
	"git:rebaser": "bg-pink-500/15 text-pink-400",
	"markdown-tasks:do-task": "bg-orange-500/15 text-orange-400",
	"general-purpose": "bg-gray-500/15 text-gray-400",
};

function getTypeStyle(agentType: string | null): string {
	if (agentType === null) return "bg-gray-500/15 text-gray-400";
	return AGENT_TYPE_STYLES[agentType] ?? "bg-gray-500/15 text-gray-400";
}

function getShortType(agentType: string | null): string {
	if (agentType === null) return "agent";
	return agentType.split(":").at(-1) ?? agentType;
}

export function SubagentTypeBadges({
	agentType,
	attributionAgent,
	model,
}: {
	agentType: string | null;
	attributionAgent: string | null;
	model: string | null;
}) {
	const modelLabel = formatModelName(model);
	return (
		<>
			<span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${getTypeStyle(agentType)}`}>
				{getShortType(agentType)}
			</span>
			{attributionAgent && (
				<span
					className="shrink-0 rounded bg-fill-control px-1.5 py-0.5 font-mono text-[10px] text-t6"
					title="Transcript attribution agent"
				>
					{attributionAgent}
				</span>
			)}
			{/* The model the agent itself ran on, in the flat meta token the row's
          other metadata uses rather than a badge of its own. */}
			{modelLabel && <span className="shrink-0 text-[10px] text-t6">{modelLabel}</span>}
		</>
	);
}

function getDurationMs(agent: Subagent): number | null {
	if (agent.startedAt === null || agent.finishedAt === null) return null;
	return new Date(agent.finishedAt).getTime() - new Date(agent.startedAt).getTime();
}

function formatTime(timestamp: string | null): string {
	if (timestamp === null) return "";
	return new Date(timestamp).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
}

interface TreePresentation {
	liveStatuses: Map<string, "running" | "ended">;
	indexedAgentIds: Set<string>;
}

/** The keyboard-reachable chevron; the row's own click is a pointer shortcut for it. */
function ExpandToggle({expanded, onToggle}: {expanded: boolean; onToggle: (next: boolean) => void}) {
	return (
		<button
			type="button"
			aria-expanded={expanded}
			aria-label={expanded ? "Collapse" : "Expand"}
			className="flex w-4 shrink-0 cursor-pointer text-t6"
			onClick={(event) => {
				event.stopPropagation();
				onToggle(!expanded);
			}}
		>
			{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
		</button>
	);
}

function TreeNode({node, presentation}: {node: SubagentTreeNode; presentation: TreePresentation}) {
	const hasChildren = node.children.length > 0;
	const [expanded, setExpanded] = useState(true);
	const agentDurationMs = getDurationMs(node.agent);
	const canonicalId = toSubagentSessionId(node.agent.id);
	const liveStatus = presentation.liveStatuses.get(canonicalId);

	return (
		<div>
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer shortcut for the chevron button, which is the keyboard control */}
			<div
				className={`group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 hover:bg-surface-0/50 ${liveStatus === "ended" ? "opacity-60" : ""}`}
				onClick={() => {
					if (hasChildren) setExpanded((current) => !current);
				}}
			>
				{hasChildren ? (
					<ExpandToggle expanded={expanded} onToggle={setExpanded} />
				) : (
					<span className="w-4 shrink-0" />
				)}
				<SubagentTypeBadges
					agentType={node.agent.agentType}
					attributionAgent={node.agent.attributionAgent}
					model={node.agent.model}
				/>
				<span className="min-w-0 truncate text-xs text-primary">
					{node.agent.description ?? node.agent.slug ?? node.agent.id}
				</span>
				{liveStatus === "running" && (
					<span className="flex shrink-0 items-center gap-1 text-[10px] text-success-000">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success-000" />
						running
					</span>
				)}
				{agentDurationMs !== null && (
					<span className="shrink-0 text-[10px] tabular-nums text-t6">{formatDuration(agentDurationMs)}</span>
				)}
				<span className="ml-auto shrink-0 text-[10px] text-t6">{formatTime(node.agent.startedAt)}</span>
				{presentation.indexedAgentIds.has(canonicalId) && (
					<Link
						to="/session/$id"
						params={{id: node.agent.id}}
						className="hidden shrink-0 items-center gap-1 text-[10px] text-accent-100 hover:underline group-hover:inline-flex"
						onClick={(event) => {
							event.stopPropagation();
						}}
					>
						<Bot size={10} />
						view
					</Link>
				)}
			</div>
			{hasChildren && expanded && (
				<div className="ml-5 border-l border-strong pl-3">
					<TreeEntries entries={node.children} presentation={presentation} />
				</div>
			)}
		</div>
	);
}

function ParallelGroupNode({group, presentation}: {group: ParallelSubagentGroup; presentation: TreePresentation}) {
	const [expanded, setExpanded] = useState(true);

	return (
		<div>
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer shortcut for the chevron button, which is the keyboard control */}
			<div
				className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 hover:bg-surface-0/50"
				onClick={() => {
					setExpanded((current) => !current);
				}}
			>
				<ExpandToggle expanded={expanded} onToggle={setExpanded} />
				<span className="shrink-0 rounded bg-accent-000/12 px-1.5 py-0.5 text-[10px] font-medium text-accent-100">
					parallel &times;{group.children.length}
				</span>
				<span className="min-w-0 truncate text-xs text-t6">{summarizeParallelGroup(group)}</span>
				<span className="ml-auto shrink-0 text-[10px] tabular-nums text-t6">
					{formatDuration(group.wallClockMs)}
				</span>
			</div>
			{expanded && (
				<div className="ml-5 border-l border-accent-000/15 pl-3">
					{group.children.map((child) => (
						<TreeNode key={child.agent.id} node={child} presentation={presentation} />
					))}
				</div>
			)}
		</div>
	);
}

function WorkflowPhaseNode({
	phase,
	settled,
	presentation,
}: {
	phase: WorkflowPhaseGroup;
	settled: boolean;
	presentation: TreePresentation;
}) {
	// Upstream's default: open while the run is running and the phase has agents.
	const [expanded, setExpanded] = useState(!settled && phase.agents.length > 0);

	return (
		<div>
			<button
				type="button"
				aria-expanded={expanded}
				aria-label={phaseAriaLabel(phase)}
				className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 text-start hover:bg-surface-0/50"
				onClick={() => {
					setExpanded((current) => !current);
				}}
			>
				<span className="min-w-0 truncate text-xs text-secondary">{phase.title}</span>
				<span className="shrink-0 text-[10px] tabular-nums text-ink-muted">
					{phase.counts.done}/{phase.counts.total}
				</span>
				<ChevronRight
					size={14}
					aria-hidden="true"
					className={`shrink-0 text-t6 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
				/>
			</button>
			{expanded && (
				<div className="ml-5 border-l border-strong pl-3">
					{phase.agents.map((agent) => (
						<TreeNode key={agent.agent.id} node={agent} presentation={presentation} />
					))}
				</div>
			)}
		</div>
	);
}

function WorkflowRunNode({run, presentation}: {run: WorkflowRunGroup; presentation: TreePresentation}) {
	const [expanded, setExpanded] = useState(true);

	return (
		<div>
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer shortcut for the chevron button, which is the keyboard control */}
			<div
				className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 hover:bg-surface-0/50"
				onClick={() => {
					setExpanded((current) => !current);
				}}
			>
				<ExpandToggle expanded={expanded} onToggle={setExpanded} />
				<span className="min-w-0 truncate text-xs text-primary">{run.name}</span>
				<span className="shrink-0 text-[10px] tabular-nums text-t6">
					{run.agentCount} {run.agentCount === 1 ? "agent" : "agents"}
				</span>
				{run.durationMs > 0 && (
					<span className="shrink-0 text-[10px] tabular-nums text-t6">{formatDuration(run.durationMs)}</span>
				)}
				<span className="ml-auto shrink-0 text-[10px] text-t6">{formatTime(run.startedAt)}</span>
			</div>
			{expanded && (
				<div className="ml-5 border-l border-accent-000/15 pl-3">
					{run.phases.map((phase) => (
						<WorkflowPhaseNode
							key={phase.index}
							phase={phase}
							settled={run.settled}
							presentation={presentation}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function summarizeParallelGroup(group: ParallelSubagentGroup): string {
	const types = new Set(group.children.map((child) => getShortType(child.agent.agentType)));
	const names = [...types].join(", ");
	return types.size === 1 ? `${names} tasks` : names;
}

function TreeEntries({entries, presentation}: {entries: SubagentTreeEntry[]; presentation: TreePresentation}) {
	return entries.map((entry, index) => {
		if (!("type" in entry)) return <TreeNode key={entry.agent.id} node={entry} presentation={presentation} />;
		if (entry.type === "workflow-run") {
			return <WorkflowRunNode key={`run-${entry.runId}`} run={entry} presentation={presentation} />;
		}
		return <ParallelGroupNode key={`parallel-${index}`} group={entry} presentation={presentation} />;
	});
}

export {TreeEntries as SubagentTreeEntries};

export function SubagentTree({
	agents,
	sessionId,
	workflowRuns,
}: {
	agents: Subagent[];
	sessionId?: string;
	workflowRuns?: readonly WorkflowRunInfo[] | undefined;
}) {
	const {liveSubagents} = useClaudeEvents();
	const indexedAgentIds = useMemo(() => new Set(agents.map((agent) => toSubagentSessionId(agent.id))), [agents]);
	const indexedSessionIds = useMemo(() => new Set(agents.map((agent) => agent.sessionId)), [agents]);
	const relevantLiveNodes = useMemo(
		() =>
			[...liveSubagents.values()].filter((node) =>
				sessionId === undefined ? indexedSessionIds.has(node.sessionId) : node.sessionId === sessionId,
			),
		[indexedSessionIds, liveSubagents, sessionId],
	);
	const mergedAgents = useMemo(() => mergeLiveSubagents(agents, relevantLiveNodes), [agents, relevantLiveNodes]);
	const liveStatuses = useMemo(
		() =>
			new Map(
				relevantLiveNodes
					.filter((node) => !indexedAgentIds.has(node.agentId))
					.map((node) => [node.agentId, node.endedAt === null ? "running" : "ended"] as const),
			),
		[indexedAgentIds, relevantLiveNodes],
	);
	const tree = useMemo(
		() => buildSubagentTree(mergedAgents, workflowRuns === undefined ? undefined : {workflowRuns}),
		[mergedAgents, workflowRuns],
	);
	const dateGroups = useMemo(() => groupSubagentTreeByDate(tree), [tree]);
	if (tree.length === 0) {
		return <p className="mt-4 text-sm text-t6">No subagents for this session.</p>;
	}
	return dateGroups.map((group) => (
		<section key={group.key}>
			<h2 className="sticky top-0 z-10 border-b border-border bg-surface-2 pb-1 pt-2 text-sm font-semibold text-t6">
				{group.label}
			</h2>
			<div className="mb-4 mt-2">
				<TreeEntries entries={group.entries} presentation={{indexedAgentIds, liveStatuses}} />
			</div>
		</section>
	));
}
