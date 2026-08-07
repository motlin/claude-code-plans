import { Link } from "@tanstack/react-router";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Subagent } from "../lib/subagents";
import {
  buildSubagentTree,
  groupSubagentTreeByDate,
  type ParallelSubagentGroup,
  type SubagentTreeEntry,
  type SubagentTreeNode,
} from "../lib/subagent-tree";
import { formatDuration } from "./tool-renderers/shared";
import { useClaudeEvents } from "../hooks/use-claude-events";
import { mergeLiveSubagents } from "../lib/live-subagent-store";
import { toSubagentSessionId } from "../lib/subagents";

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
  return agentType.split(":").at(-1)!;
}

export function SubagentTypeBadges({
  agentType,
  attributionAgent,
}: {
  agentType: string | null;
  attributionAgent: string | null;
}) {
  return (
    <>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${getTypeStyle(agentType)}`}
      >
        {getShortType(agentType)}
      </span>
      {attributionAgent && (
        <span
          className="shrink-0 rounded bg-bg-300/60 px-1.5 py-0.5 font-mono text-[10px] text-text-500"
          title="Transcript attribution agent"
        >
          {attributionAgent}
        </span>
      )}
    </>
  );
}

function getDurationMs(agent: Subagent): number | null {
  if (agent.startedAt === null || agent.finishedAt === null) return null;
  return new Date(agent.finishedAt).getTime() - new Date(agent.startedAt).getTime();
}

function formatTime(timestamp: string | null): string {
  if (timestamp === null) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface TreePresentation {
  liveStatuses: Map<string, "running" | "ended">;
  indexedAgentIds: Set<string>;
}

function TreeNode({
  node,
  presentation,
}: {
  node: SubagentTreeNode;
  presentation: TreePresentation;
}) {
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(true);
  const agentDurationMs = getDurationMs(node.agent);
  const canonicalId = toSubagentSessionId(node.agent.id);
  const liveStatus = presentation.liveStatuses.get(canonicalId);

  return (
    <div>
      <div
        className={`group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 hover:bg-bg-200/50 ${liveStatus === "ended" ? "opacity-60" : ""}`}
        onClick={() => hasChildren && setExpanded((current) => !current)}
      >
        <span className="w-4 shrink-0 text-text-500">
          {hasChildren ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </span>
        <SubagentTypeBadges
          agentType={node.agent.agentType}
          attributionAgent={node.agent.attributionAgent}
        />
        <span className="min-w-0 truncate text-xs text-text-100">
          {node.agent.description ?? node.agent.slug ?? node.agent.id}
        </span>
        {liveStatus === "running" && (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-success-000">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success-000" />
            running
          </span>
        )}
        {agentDurationMs !== null && (
          <span className="shrink-0 text-[10px] tabular-nums text-text-500">
            {formatDuration(agentDurationMs)}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-text-500">
          {formatTime(node.agent.startedAt)}
        </span>
        {presentation.indexedAgentIds.has(canonicalId) && (
          <Link
            to="/session/$id"
            params={{ id: node.agent.id }}
            className="hidden shrink-0 items-center gap-1 text-[10px] text-accent-100 hover:underline group-hover:inline-flex"
            onClick={(event) => event.stopPropagation()}
          >
            <Bot size={10} />
            view
          </Link>
        )}
      </div>
      {hasChildren && expanded && (
        <div className="ml-5 border-l border-border-300/20 pl-3">
          <TreeEntries entries={node.children} presentation={presentation} />
        </div>
      )}
    </div>
  );
}

function ParallelGroupNode({
  group,
  presentation,
}: {
  group: ParallelSubagentGroup;
  presentation: TreePresentation;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 hover:bg-bg-200/50"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="w-4 shrink-0 text-text-500">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="shrink-0 rounded bg-accent-000/12 px-1.5 py-0.5 text-[10px] font-medium text-accent-100">
          parallel &times;{group.children.length}
        </span>
        <span className="min-w-0 truncate text-xs text-text-500">
          {summarizeParallelGroup(group)}
        </span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-text-500">
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

function summarizeParallelGroup(group: ParallelSubagentGroup): string {
  const types = new Set(group.children.map((child) => getShortType(child.agent.agentType)));
  if (types.size === 1) return `${[...types][0]!} tasks`;
  return [...types].join(", ");
}

function isParallelGroup(entry: SubagentTreeEntry): entry is ParallelSubagentGroup {
  return "type" in entry;
}

function TreeEntries({
  entries,
  presentation,
}: {
  entries: SubagentTreeEntry[];
  presentation: TreePresentation;
}) {
  return entries.map((entry, index) =>
    isParallelGroup(entry) ? (
      <ParallelGroupNode key={`parallel-${index}`} group={entry} presentation={presentation} />
    ) : (
      <TreeNode key={entry.agent.id} node={entry} presentation={presentation} />
    ),
  );
}

export function SubagentTree({ agents, sessionId }: { agents: Subagent[]; sessionId?: string }) {
  const { liveSubagents } = useClaudeEvents();
  const indexedAgentIds = useMemo(
    () => new Set(agents.map((agent) => toSubagentSessionId(agent.id))),
    [agents],
  );
  const indexedSessionIds = useMemo(
    () => new Set(agents.map((agent) => agent.sessionId)),
    [agents],
  );
  const relevantLiveNodes = useMemo(
    () =>
      [...liveSubagents.values()].filter((node) =>
        sessionId === undefined
          ? indexedSessionIds.has(node.sessionId)
          : node.sessionId === sessionId,
      ),
    [indexedSessionIds, liveSubagents, sessionId],
  );
  const mergedAgents = useMemo(
    () => mergeLiveSubagents(agents, relevantLiveNodes),
    [agents, relevantLiveNodes],
  );
  const liveStatuses = useMemo(
    () =>
      new Map(
        relevantLiveNodes
          .filter((node) => !indexedAgentIds.has(node.agentId))
          .map((node) => [node.agentId, node.endedAt === null ? "running" : "ended"] as const),
      ),
    [indexedAgentIds, relevantLiveNodes],
  );
  const tree = useMemo(() => buildSubagentTree(mergedAgents), [mergedAgents]);
  const dateGroups = useMemo(() => groupSubagentTreeByDate(tree), [tree]);
  if (tree.length === 0) {
    return <p className="mt-4 text-sm text-text-500">No subagents for this session.</p>;
  }
  return dateGroups.map((group) => (
    <section key={group.key}>
      <h2 className="sticky top-0 z-10 border-b border-border-300/15 bg-bg-000 pb-1 pt-2 text-sm font-semibold text-text-500">
        {group.label}
      </h2>
      <div className="mb-4 mt-2">
        <TreeEntries entries={group.entries} presentation={{ indexedAgentIds, liveStatuses }} />
      </div>
    </section>
  ));
}
