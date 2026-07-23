import { Link } from "@tanstack/react-router";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Subagent } from "../lib/subagents";
import {
  buildSubagentTree,
  type ParallelSubagentGroup,
  type SubagentTreeEntry,
  type SubagentTreeNode,
} from "../lib/subagent-tree";
import { formatDuration } from "./tool-renderers/shared";

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

function getDurationMs(agent: Subagent): number | null {
  if (agent.startedAt === null || agent.finishedAt === null) return null;
  return new Date(agent.finishedAt).getTime() - new Date(agent.startedAt).getTime();
}

function formatTime(timestamp: string | null): string {
  if (timestamp === null) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function TreeNode({ node }: { node: SubagentTreeNode }) {
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(true);
  const agentDurationMs = getDurationMs(node.agent);

  return (
    <div>
      <div
        className="group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 hover:bg-bg-200/50"
        onClick={() => hasChildren && setExpanded((current) => !current)}
      >
        <span className="w-4 shrink-0 text-text-500">
          {hasChildren ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${getTypeStyle(node.agent.agentType)}`}
        >
          {getShortType(node.agent.agentType)}
        </span>
        <span className="min-w-0 truncate text-xs text-text-100">
          {node.agent.description ?? node.agent.slug ?? node.agent.id}
        </span>
        {agentDurationMs !== null && (
          <span className="shrink-0 text-[10px] tabular-nums text-text-500">
            {formatDuration(agentDurationMs)}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-text-500">
          {formatTime(node.agent.startedAt)}
        </span>
        <Link
          to="/session/$id"
          params={{ id: node.agent.id }}
          className="hidden shrink-0 items-center gap-1 text-[10px] text-accent-100 hover:underline group-hover:inline-flex"
          onClick={(event) => event.stopPropagation()}
        >
          <Bot size={10} />
          view
        </Link>
      </div>
      {hasChildren && expanded && (
        <div className="ml-5 border-l border-border-300/20 pl-3">
          <TreeEntries entries={node.children} />
        </div>
      )}
    </div>
  );
}

function ParallelGroupNode({ group }: { group: ParallelSubagentGroup }) {
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
            <TreeNode key={child.agent.id} node={child} />
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

function TreeEntries({ entries }: { entries: SubagentTreeEntry[] }) {
  return entries.map((entry, index) =>
    isParallelGroup(entry) ? (
      <ParallelGroupNode key={`parallel-${index}`} group={entry} />
    ) : (
      <TreeNode key={entry.agent.id} node={entry} />
    ),
  );
}

export function SubagentTree({ agents }: { agents: Subagent[] }) {
  const tree = useMemo(() => buildSubagentTree(agents), [agents]);
  if (tree.length === 0) return null;
  return <TreeEntries entries={tree} />;
}
