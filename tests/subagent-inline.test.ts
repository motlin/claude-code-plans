import { describe, expect, it } from "vite-plus/test";
import { buildClientToolCall, buildSubagentLookup } from "../src/components/tool-renderers/types";
import type { Subagent } from "../src/lib/subagents";
import type { ToolResultInfo } from "../src/lib/sessions";
import type { ToolUseBlock } from "../src/lib/schemas";

function makeAgent(overrides: Partial<Subagent> & { id: string }): Subagent {
  return {
    sessionId: "sess-1",
    projectId: "proj-1",
    parentAgentId: null,
    agentType: null,
    slug: null,
    description: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function agentBlock(id: string, input: Record<string, unknown>): ToolUseBlock {
  return { type: "tool_use", id, name: "Agent", input } as ToolUseBlock;
}

function resultMap(entries: Record<string, string>): Map<string, ToolResultInfo> {
  const map = new Map<string, ToolResultInfo>();
  for (const [id, result] of Object.entries(entries)) {
    map.set(id, { result, isError: false, resultUuid: `${id}-res` });
  }
  return map;
}

describe("buildSubagentLookup + resolveSubagentInfo (inline)", () => {
  it("resolves subagentInfo by bare agent id from the tool result text", () => {
    const lookup = buildSubagentLookup([
      makeAgent({
        id: "agent-abc123",
        agentType: "general-purpose",
        slug: "explore",
        description: "Find the thing",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:05.000Z",
      }),
    ]);

    const call = buildClientToolCall(
      agentBlock("tu-1", { subagent_type: "general-purpose", description: "Find the thing" }),
      "src-uuid",
      resultMap({ "tu-1": "agentId: abc123\nDone." }),
      undefined,
      lookup,
    );

    expect(call.subagentInfo?.agentId).toBe("agent-abc123");
    expect(call.subagentInfo?.slug).toBe("explore");
    expect(call.subagentInfo?.status).toBe("done");
  });

  it("falls back to (agentType, description) when the result has no agentId", () => {
    const lookup = buildSubagentLookup([
      makeAgent({
        id: "agent-xyz",
        agentType: "code-reviewer",
        description: "Review the diff",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);

    const call = buildClientToolCall(
      agentBlock("tu-2", { subagent_type: "code-reviewer", description: "Review the diff" }),
      "src-uuid",
      resultMap({ "tu-2": "no id in here" }),
      undefined,
      lookup,
    );

    expect(call.subagentInfo?.agentId).toBe("agent-xyz");
    // Not finished -> running
    expect(call.subagentInfo?.status).toBe("running");
  });

  it("flags parallel siblings started within 2s with a group size", () => {
    const lookup = buildSubagentLookup([
      makeAgent({ id: "agent-a", startedAt: "2026-01-01T00:00:00.000Z" }),
      makeAgent({ id: "agent-b", startedAt: "2026-01-01T00:00:01.000Z" }),
    ]);

    const call = buildClientToolCall(
      agentBlock("tu-3", {}),
      "src-uuid",
      resultMap({ "tu-3": "agentId: a" }),
      undefined,
      lookup,
    );

    expect(call.subagentInfo?.parallelGroupSize).toBe(2);
  });

  it("overrides status to error when the tool call errored", () => {
    const lookup = buildSubagentLookup([
      makeAgent({ id: "agent-err", finishedAt: "2026-01-01T00:00:05.000Z" }),
    ]);
    const map = new Map<string, ToolResultInfo>([
      ["tu-4", { result: "agentId: err", isError: true, resultUuid: "tu-4-res" }],
    ]);

    const call = buildClientToolCall(agentBlock("tu-4", {}), "src-uuid", map, undefined, lookup);

    expect(call.isError).toBe(true);
    expect(call.subagentInfo?.status).toBe("error");
  });

  it("does not attach subagentInfo to non-Agent tool calls", () => {
    const lookup = buildSubagentLookup([makeAgent({ id: "agent-a" })]);
    const call = buildClientToolCall(
      { type: "tool_use", id: "tu-5", name: "Bash", input: { command: "ls" } } as ToolUseBlock,
      "src-uuid",
      resultMap({ "tu-5": "agentId: a" }),
      undefined,
      lookup,
    );
    expect(call.subagentInfo).toBeUndefined();
  });

  it("attaches nothing when no lookup is provided", () => {
    const call = buildClientToolCall(
      agentBlock("tu-6", {}),
      "src-uuid",
      resultMap({ "tu-6": "agentId: a" }),
    );
    expect(call.subagentInfo).toBeUndefined();
  });
});
