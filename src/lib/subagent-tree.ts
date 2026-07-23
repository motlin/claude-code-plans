import type { Subagent } from "./subagents";

export interface SubagentTreeNode {
  agent: Subagent;
  children: SubagentTreeEntry[];
}

export interface ParallelSubagentGroup {
  type: "parallel";
  children: SubagentTreeNode[];
  wallClockMs: number;
}

export type SubagentTreeEntry = SubagentTreeNode | ParallelSubagentGroup;

function compareStartedAt(left: Subagent, right: Subagent): number {
  if (left.startedAt === right.startedAt) return left.id.localeCompare(right.id);
  if (left.startedAt === null) return 1;
  if (right.startedAt === null) return -1;
  return left.startedAt.localeCompare(right.startedAt);
}

function durationMs(agent: Subagent): number {
  if (agent.startedAt === null || agent.finishedAt === null) return 0;
  return new Date(agent.finishedAt).getTime() - new Date(agent.startedAt).getTime();
}

export function buildSubagentTree(agents: Subagent[]): SubagentTreeEntry[] {
  const agentsByParent = new Map<string | null, Subagent[]>();
  for (const agent of agents) {
    const siblings = agentsByParent.get(agent.parentAgentId) ?? [];
    siblings.push(agent);
    agentsByParent.set(agent.parentAgentId, siblings);
  }

  function buildChildren(parentAgentId: string | null): SubagentTreeEntry[] {
    const children = agentsByParent.get(parentAgentId);
    if (children === undefined) return [];

    children.sort(compareStartedAt);
    const entries: SubagentTreeEntry[] = [];

    for (let index = 0; index < children.length; index++) {
      const first = children[index]!;
      const parallelAgents = [first];
      const firstStartedAt = first.startedAt === null ? null : new Date(first.startedAt).getTime();

      while (index + 1 < children.length) {
        const next = children[index + 1]!;
        const nextStartedAt = next.startedAt === null ? null : new Date(next.startedAt).getTime();
        if (
          firstStartedAt === null ||
          nextStartedAt === null ||
          Math.abs(nextStartedAt - firstStartedAt) >= 2_000
        ) {
          break;
        }
        parallelAgents.push(next);
        index++;
      }

      const nodes = parallelAgents.map((agent) => ({
        agent,
        children: buildChildren(agent.id),
      }));
      if (nodes.length === 1) {
        entries.push(nodes[0]!);
        continue;
      }

      entries.push({
        type: "parallel",
        children: nodes,
        wallClockMs: Math.max(...parallelAgents.map(durationMs)),
      });
    }

    return entries;
  }

  return buildChildren(null);
}
