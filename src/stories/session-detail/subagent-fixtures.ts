import type { DbSubagent } from "../../lib/db/queries";

export function makeAgent(overrides: Partial<DbSubagent> & { id: string }): DbSubagent {
  return {
    sessionId: "session-1",
    projectId: "project-1",
    parentAgentId: null,
    agentType: "general-purpose",
    slug: null,
    description: null,
    startedAt: "2026-04-19T10:00:00Z",
    finishedAt: "2026-04-19T10:01:00Z",
    filePath: `/fake/${overrides.id}.jsonl`,
    mtimeMs: Date.now(),
    ...overrides,
  };
}
