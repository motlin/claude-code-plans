import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { getSubagentsForSession } from "../src/lib/db/queries";
import * as schema from "../src/lib/db/schema";
import { buildSubagentTree, type SubagentTreeEntry } from "../src/lib/subagent-tree";
import { extractPendingSubagents, toClientSubagent, type Subagent } from "../src/lib/subagents";

function makeAgent(overrides: Partial<Subagent> & { id: string }): Subagent {
  return {
    sessionId: "session-test",
    projectId: "project-test",
    parentAgentId: null,
    agentType: "general-purpose",
    slug: null,
    description: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

type TreeSummary =
  | { kind: "agent"; id: string; children: TreeSummary[] }
  | { kind: "parallel"; wallClockMs: number; children: TreeSummary[] };

function summarizeTree(entries: SubagentTreeEntry[]): TreeSummary[] {
  return entries.map((entry) => {
    if ("type" in entry) {
      return {
        kind: "parallel",
        wallClockMs: entry.wallClockMs,
        children: entry.children.map((child) => ({
          kind: "agent",
          id: child.agent.id,
          children: summarizeTree(child.children),
        })),
      };
    }
    return {
      kind: "agent",
      id: entry.agent.id,
      children: summarizeTree(entry.children),
    };
  });
}

describe("buildSubagentTree", () => {
  it("builds a flat list for serial agents", () => {
    const agents = [
      makeAgent({
        id: "agent-a",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:10.000Z",
      }),
      makeAgent({
        id: "agent-b",
        startedAt: "1999-12-31T00:00:15.000Z",
        finishedAt: "1999-12-31T00:00:25.000Z",
      }),
      makeAgent({
        id: "agent-c",
        startedAt: "1999-12-31T00:00:30.000Z",
        finishedAt: "1999-12-31T00:00:40.000Z",
      }),
    ];

    expect(summarizeTree(buildSubagentTree(agents))).toStrictEqual([
      { kind: "agent", id: "agent-a", children: [] },
      { kind: "agent", id: "agent-b", children: [] },
      { kind: "agent", id: "agent-c", children: [] },
    ]);
  });

  it("groups siblings started within two seconds but not at the boundary", () => {
    const agents = [
      makeAgent({
        id: "agent-a",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:10.000Z",
      }),
      makeAgent({
        id: "agent-b",
        startedAt: "1999-12-31T00:00:01.999Z",
        finishedAt: "1999-12-31T00:00:16.999Z",
      }),
      makeAgent({
        id: "agent-c",
        startedAt: "1999-12-31T00:00:02.000Z",
        finishedAt: "1999-12-31T00:00:07.000Z",
      }),
    ];

    expect(summarizeTree(buildSubagentTree(agents))).toStrictEqual([
      {
        kind: "parallel",
        wallClockMs: 15_000,
        children: [
          { kind: "agent", id: "agent-a", children: [] },
          { kind: "agent", id: "agent-b", children: [] },
        ],
      },
      { kind: "agent", id: "agent-c", children: [] },
    ]);
  });

  it("nests children under their parent", () => {
    const agents = [
      makeAgent({
        id: "agent-parent",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:30.000Z",
      }),
      makeAgent({
        id: "agent-child",
        parentAgentId: "agent-parent",
        startedAt: "1999-12-31T00:00:05.000Z",
        finishedAt: "1999-12-31T00:00:15.000Z",
      }),
    ];

    expect(summarizeTree(buildSubagentTree(agents))).toStrictEqual([
      {
        kind: "agent",
        id: "agent-parent",
        children: [{ kind: "agent", id: "agent-child", children: [] }],
      },
    ]);
  });

  it("handles deep nesting", () => {
    const agents = [
      makeAgent({
        id: "agent-root",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:01:00.000Z",
      }),
      makeAgent({
        id: "agent-middle",
        parentAgentId: "agent-root",
        startedAt: "1999-12-31T00:00:10.000Z",
        finishedAt: "1999-12-31T00:00:40.000Z",
      }),
      makeAgent({
        id: "agent-deep",
        parentAgentId: "agent-middle",
        startedAt: "1999-12-31T00:00:15.000Z",
        finishedAt: "1999-12-31T00:00:25.000Z",
      }),
    ];

    expect(summarizeTree(buildSubagentTree(agents))).toStrictEqual([
      {
        kind: "agent",
        id: "agent-root",
        children: [
          {
            kind: "agent",
            id: "agent-middle",
            children: [{ kind: "agent", id: "agent-deep", children: [] }],
          },
        ],
      },
    ]);
  });

  it("returns no entries for no agents", () => {
    expect(buildSubagentTree([])).toStrictEqual([]);
  });
});

describe("DB-backed subagents", () => {
  let db: AppDb;

  beforeEach(() => {
    db = openTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("preserves parent and active fields in the client shape", () => {
    db.index
      .insert(schema.subagents)
      .values({
        id: "agent-child",
        sessionId: "session-test",
        projectId: "project-test",
        parentAgentId: "agent-parent",
        agentType: "Explore",
        slug: "explore-test",
        description: "Inspect test files",
        startedAt: "1999-12-31T00:00:05.000Z",
        finishedAt: null,
        filePath: "/tmp/test/agent-child.jsonl",
        mtimeMs: 1_000,
      })
      .run();

    const agents = getSubagentsForSession(db.index, "session-test").map(toClientSubagent);
    expect(agents).toStrictEqual([
      {
        id: "agent-child",
        sessionId: "session-test",
        projectId: "project-test",
        parentAgentId: "agent-parent",
        agentType: "Explore",
        slug: "explore-test",
        description: "Inspect test files",
        startedAt: "1999-12-31T00:00:05.000Z",
        finishedAt: null,
      },
    ]);
  });
});

describe("extractPendingSubagents", () => {
  it("returns Agent calls that do not have a tool result", () => {
    const records = [
      {
        sessionId: "session-test",
        timestamp: "1999-12-31T00:00:00.000Z",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-finished",
              name: "Agent",
              input: {
                subagent_type: "Explore",
                description: "Finished exploration",
              },
            },
            {
              type: "tool_use",
              id: "tool-active",
              name: "Agent",
              input: {
                subagent_type: "general-purpose",
                description: "Active implementation",
              },
            },
          ],
        },
      },
      {
        sessionId: "session-test",
        timestamp: "1999-12-31T00:01:00.000Z",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-finished",
              content: "agentId: finished-agent",
            },
          ],
        },
      },
    ];

    expect(extractPendingSubagents(records)).toStrictEqual([
      {
        key: "tool-active",
        sessionId: "session-test",
        agentType: "general-purpose",
        agentId: "",
        description: "Active implementation",
      },
    ]);
  });
});
