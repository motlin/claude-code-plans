import type { Subagent } from "../../lib/subagents";

export function makeAgent(overrides: Partial<Subagent> & { id: string }): Subagent {
  return {
    sessionId: "session-1",
    projectId: "project-1",
    parentAgentId: null,
    agentType: "general-purpose",
    slug: null,
    description: null,
    startedAt: "2026-04-19T10:00:00Z",
    finishedAt: "2026-04-19T10:01:00Z",
    ...overrides,
  };
}
