import { describe, expect, it } from "vite-plus/test";
import { layoutSequence, type SequenceLayout } from "../src/components/subagent-sequence";
import type { DbSubagent } from "../src/lib/db/queries";

function makeAgent(overrides: Partial<DbSubagent> & { id: string }): DbSubagent {
  return {
    sessionId: "sess-1",
    projectId: "proj-1",
    parentAgentId: null,
    agentType: null,
    attributionAgent: null,
    slug: null,
    description: null,
    startedAt: null,
    finishedAt: null,
    filePath: `/path/${overrides.id}.jsonl`,
    mtimeMs: 1000,
    ...overrides,
  };
}

describe("layoutSequence", () => {
  it("returns empty layout when no agents have timing", () => {
    const layout = layoutSequence([makeAgent({ id: "a" })]);
    expect(layout.lifelines).toStrictEqual([]);
    expect(layout.spawns).toStrictEqual([]);
    expect(layout.returns).toStrictEqual([]);
    expect(layout.startMs).toBe(0);
    expect(layout.endMs).toBe(0);
  });

  it("returns empty layout for empty input", () => {
    const layout = layoutSequence([]);
    expect(layout.lifelines).toStrictEqual([]);
  });

  it("produces one lifeline per agent with timing, assigning columns by start time", () => {
    const agents = [
      makeAgent({
        id: "b",
        startedAt: "1999-12-31T00:00:15.000Z",
        finishedAt: "1999-12-31T00:00:25.000Z",
      }),
      makeAgent({
        id: "a",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:10.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    expect(layout.lifelines.map((l) => l.agent.id)).toStrictEqual(["a", "b"]);
    expect(layout.lifelines[0]!.column).toBe(0);
    expect(layout.lifelines[1]!.column).toBe(1);
  });

  it("computes overall time bounds", () => {
    const agents = [
      makeAgent({
        id: "a",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:10.000Z",
      }),
      makeAgent({
        id: "b",
        startedAt: "1999-12-31T00:00:15.000Z",
        finishedAt: "1999-12-31T00:00:25.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    expect(layout.startMs).toBe(new Date("1999-12-31T00:00:00.000Z").getTime());
    expect(layout.endMs).toBe(new Date("1999-12-31T00:00:25.000Z").getTime());
    expect(layout.totalMs).toBe(25000);
  });

  it("emits a spawn arrow and a return arrow per parent-child relationship", () => {
    const agents = [
      makeAgent({
        id: "parent",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:30.000Z",
      }),
      makeAgent({
        id: "child",
        parentAgentId: "parent",
        startedAt: "1999-12-31T00:00:10.000Z",
        finishedAt: "1999-12-31T00:00:20.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    expect(layout.spawns.length).toBe(1);
    expect(layout.returns.length).toBe(1);

    const spawn = layout.spawns[0]!;
    expect(spawn.parentId).toBe("parent");
    expect(spawn.childId).toBe("child");
    expect(spawn.atMs).toBe(new Date("1999-12-31T00:00:10.000Z").getTime());

    const ret = layout.returns[0]!;
    expect(ret.parentId).toBe("parent");
    expect(ret.childId).toBe("child");
    expect(ret.atMs).toBe(new Date("1999-12-31T00:00:20.000Z").getTime());
  });

  it("sets parent and child columns on arrows so they connect lifelines", () => {
    const agents = [
      makeAgent({
        id: "parent",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:30.000Z",
      }),
      makeAgent({
        id: "child",
        parentAgentId: "parent",
        startedAt: "1999-12-31T00:00:10.000Z",
        finishedAt: "1999-12-31T00:00:20.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    const parent = layout.lifelines.find((l) => l.agent.id === "parent")!;
    const child = layout.lifelines.find((l) => l.agent.id === "child")!;
    expect(layout.spawns[0]!.parentColumn).toBe(parent.column);
    expect(layout.spawns[0]!.childColumn).toBe(child.column);
    expect(layout.returns[0]!.parentColumn).toBe(parent.column);
    expect(layout.returns[0]!.childColumn).toBe(child.column);
  });

  it("omits spawn/return arrows when parent has no timing", () => {
    const agents = [
      makeAgent({ id: "orphan-parent" }), // no timing, will be skipped
      makeAgent({
        id: "child",
        parentAgentId: "orphan-parent",
        startedAt: "1999-12-31T00:00:10.000Z",
        finishedAt: "1999-12-31T00:00:20.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    expect(layout.lifelines.map((l) => l.agent.id)).toStrictEqual(["child"]);
    expect(layout.spawns).toStrictEqual([]);
    expect(layout.returns).toStrictEqual([]);
  });

  it("marks parent waiting range while a child runs", () => {
    const agents = [
      makeAgent({
        id: "parent",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:30.000Z",
      }),
      makeAgent({
        id: "child",
        parentAgentId: "parent",
        startedAt: "1999-12-31T00:00:10.000Z",
        finishedAt: "1999-12-31T00:00:20.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    const parent = layout.lifelines.find((l) => l.agent.id === "parent")!;
    expect(parent.waiting).toStrictEqual([
      {
        startMs: new Date("1999-12-31T00:00:10.000Z").getTime(),
        endMs: new Date("1999-12-31T00:00:20.000Z").getTime(),
      },
    ]);
  });

  it("merges overlapping waiting periods on parent", () => {
    const agents = [
      makeAgent({
        id: "parent",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:30.000Z",
      }),
      makeAgent({
        id: "c1",
        parentAgentId: "parent",
        startedAt: "1999-12-31T00:00:05.000Z",
        finishedAt: "1999-12-31T00:00:15.000Z",
      }),
      makeAgent({
        id: "c2",
        parentAgentId: "parent",
        startedAt: "1999-12-31T00:00:10.000Z",
        finishedAt: "1999-12-31T00:00:20.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    const parent = layout.lifelines.find((l) => l.agent.id === "parent")!;
    expect(parent.waiting).toStrictEqual([
      {
        startMs: new Date("1999-12-31T00:00:05.000Z").getTime(),
        endMs: new Date("1999-12-31T00:00:20.000Z").getTime(),
      },
    ]);
  });

  it("records depth for nested agents", () => {
    const agents = [
      makeAgent({
        id: "root",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:01:00.000Z",
      }),
      makeAgent({
        id: "mid",
        parentAgentId: "root",
        startedAt: "1999-12-31T00:00:10.000Z",
        finishedAt: "1999-12-31T00:00:40.000Z",
      }),
      makeAgent({
        id: "leaf",
        parentAgentId: "mid",
        startedAt: "1999-12-31T00:00:15.000Z",
        finishedAt: "1999-12-31T00:00:25.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    const root = layout.lifelines.find((l) => l.agent.id === "root")!;
    const mid = layout.lifelines.find((l) => l.agent.id === "mid")!;
    const leaf = layout.lifelines.find((l) => l.agent.id === "leaf")!;
    expect(root.depth).toBe(0);
    expect(mid.depth).toBe(1);
    expect(leaf.depth).toBe(2);
  });

  it("skips agents with missing timing but keeps siblings", () => {
    const agents = [
      makeAgent({
        id: "a",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:10.000Z",
      }),
      makeAgent({ id: "b" }),
      makeAgent({
        id: "c",
        startedAt: "1999-12-31T00:00:15.000Z",
        finishedAt: "1999-12-31T00:00:25.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    expect(layout.lifelines.map((l) => l.agent.id)).toStrictEqual(["a", "c"]);
  });

  it("produces tick marks proportional to total duration", () => {
    const agents = [
      makeAgent({
        id: "a",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:01:00.000Z",
      }),
    ];
    const layout: SequenceLayout = layoutSequence(agents);
    expect(layout.ticks.length).toBeGreaterThanOrEqual(2);
    expect(layout.ticks[0]!.offsetMs).toBe(0);
    expect(layout.ticks[layout.ticks.length - 1]!.offsetMs).toBeLessThanOrEqual(layout.totalMs);
  });

  it("orders parallel children by start time, then depth, then id", () => {
    const agents = [
      makeAgent({
        id: "parent",
        startedAt: "1999-12-31T00:00:00.000Z",
        finishedAt: "1999-12-31T00:00:30.000Z",
      }),
      makeAgent({
        id: "p2",
        parentAgentId: "parent",
        startedAt: "1999-12-31T00:00:10.000Z",
        finishedAt: "1999-12-31T00:00:20.000Z",
      }),
      makeAgent({
        id: "p1",
        parentAgentId: "parent",
        startedAt: "1999-12-31T00:00:10.000Z",
        finishedAt: "1999-12-31T00:00:25.000Z",
      }),
    ];
    const layout = layoutSequence(agents);
    expect(layout.lifelines.map((l) => l.agent.id)).toStrictEqual(["parent", "p1", "p2"]);
  });
});
