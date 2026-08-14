import { describe, expect, it } from "vite-plus/test";
import {
  ENDED_SUBAGENT_TTL_MS,
  MAX_LIVE_SUBAGENTS_PER_SESSION,
  mergeLiveSubagents,
  reconcileLiveSubagents,
  recordLiveSubagentStart,
  recordLiveSubagentStop,
  sweepLiveSubagents,
  type LiveSubagentNode,
} from "../src/lib/live-subagent-store";
import type { Subagent } from "../src/lib/subagents";
import { subagentStartFixture } from "./fixtures/subagent-start";

function startNode(
  target: Map<string, LiveSubagentNode>,
  parentSessionId: string,
  agentId: string,
  now: number,
): LiveSubagentNode {
  const node = recordLiveSubagentStart(
    target,
    {
      parentSessionId,
      agentId,
      agentType: "Explore",
      description: `Inspect ${agentId}`,
    },
    now,
  );
  if (!node) throw new Error("Expected a live subagent node");
  return node;
}

describe("live subagent store", () => {
  it("uses the captured parent session id, canonical raw child id, and nested edge", () => {
    const target = new Map<string, LiveSubagentNode>();

    recordLiveSubagentStart(
      target,
      {
        parentSessionId: subagentStartFixture.session_id,
        agentId: subagentStartFixture.agent_id,
        agentType: subagentStartFixture.agent_type,
        description: subagentStartFixture.agent_config.description,
      },
      Date.UTC(1999, 11, 31),
    );
    startNode(target, "agent-sub-456", "bob", Date.UTC(1999, 11, 31, 0, 0, 1));

    expect(target).toStrictEqual(
      new Map([
        [
          "agent-sub-456",
          {
            agentId: "agent-sub-456",
            sessionId: "abc-123",
            parentAgentId: null,
            agentType: "general-purpose",
            description: "research the codebase",
            startedAt: "1999-12-31T00:00:00.000Z",
            endedAt: null,
          },
        ],
        [
          "agent-bob",
          {
            agentId: "agent-bob",
            sessionId: "abc-123",
            parentAgentId: "agent-sub-456",
            agentType: "Explore",
            description: "Inspect bob",
            startedAt: "1999-12-31T00:00:01.000Z",
            endedAt: null,
          },
        ],
      ]),
    );
  });

  it("expires ended nodes after five minutes while retaining running nodes and the boundary", () => {
    const now = Date.UTC(2000, 0, 1);
    const target = new Map<string, LiveSubagentNode>();
    startNode(target, "session-parent", "alice", now - ENDED_SUBAGENT_TTL_MS - 1);
    startNode(target, "session-parent", "bob", now - ENDED_SUBAGENT_TTL_MS);
    startNode(target, "session-parent", "charlie", now - ENDED_SUBAGENT_TTL_MS - 1);
    recordLiveSubagentStop(target, "alice", now - ENDED_SUBAGENT_TTL_MS - 1);
    recordLiveSubagentStop(target, "bob", now - ENDED_SUBAGENT_TTL_MS);

    sweepLiveSubagents(target, now);

    expect([...target.keys()]).toStrictEqual(["agent-bob", "agent-charlie"]);
  });

  it("caps each root session independently and evicts its oldest ended node first", () => {
    const target = new Map<string, LiveSubagentNode>();
    startNode(target, "session-alice", "alice-0", 0);
    recordLiveSubagentStop(target, "alice-0", 1);
    for (let index = 1; index <= MAX_LIVE_SUBAGENTS_PER_SESSION; index++) {
      startNode(target, "session-alice", `alice-${index}`, index);
    }
    startNode(target, "session-bob", "bob-0", 0);

    expect({
      aliceIds: [...target.values()]
        .filter((node) => node.sessionId === "session-alice")
        .map((node) => node.agentId),
      bobIds: [...target.values()]
        .filter((node) => node.sessionId === "session-bob")
        .map((node) => node.agentId),
    }).toStrictEqual({
      aliceIds: Array.from(
        { length: MAX_LIVE_SUBAGENTS_PER_SESSION },
        (_, index) => `agent-alice-${index + 1}`,
      ),
      bobIds: ["agent-bob-0"],
    });
  });

  it("reconciles killed descendants from the root parent Stop without reopening ended nodes", () => {
    const target = new Map<string, LiveSubagentNode>();
    startNode(target, "session-parent", "alice", Date.UTC(1999, 11, 31));
    startNode(target, "session-parent", "bob", Date.UTC(1999, 11, 31, 0, 0, 1));
    startNode(target, "session-other", "charlie", Date.UTC(1999, 11, 31, 0, 0, 2));
    recordLiveSubagentStop(target, "alice", Date.UTC(1999, 11, 31, 0, 0, 3));

    const reconciled = reconcileLiveSubagents(
      target,
      "session-parent",
      Date.UTC(1999, 11, 31, 0, 0, 4),
    );

    expect({ reconciled, target }).toStrictEqual({
      reconciled: [
        {
          agentId: "agent-bob",
          sessionId: "session-parent",
          parentAgentId: null,
          agentType: "Explore",
          description: "Inspect bob",
          startedAt: "1999-12-31T00:00:01.000Z",
          endedAt: "1999-12-31T00:00:04.000Z",
        },
      ],
      target: new Map([
        [
          "agent-alice",
          {
            agentId: "agent-alice",
            sessionId: "session-parent",
            parentAgentId: null,
            agentType: "Explore",
            description: "Inspect alice",
            startedAt: "1999-12-31T00:00:00.000Z",
            endedAt: "1999-12-31T00:00:03.000Z",
          },
        ],
        [
          "agent-bob",
          {
            agentId: "agent-bob",
            sessionId: "session-parent",
            parentAgentId: null,
            agentType: "Explore",
            description: "Inspect bob",
            startedAt: "1999-12-31T00:00:01.000Z",
            endedAt: "1999-12-31T00:00:04.000Z",
          },
        ],
        [
          "agent-charlie",
          {
            agentId: "agent-charlie",
            sessionId: "session-other",
            parentAgentId: null,
            agentType: "Explore",
            description: "Inspect charlie",
            startedAt: "1999-12-31T00:00:02.000Z",
            endedAt: null,
          },
        ],
      ]),
    });
  });
});

describe("mergeLiveSubagents", () => {
  it("keeps live-only nodes but prefers the richer indexed row for matching ids", () => {
    const indexed: Subagent = {
      id: "agent-alice",
      sessionId: "session-parent",
      projectId: "project-example",
      parentAgentId: null,
      agentType: "Plan",
      attributionAgent: "workflow-subagent",
      slug: "planning",
      description: "Indexed description",
      model: null,
      startedAt: "1999-12-31T00:00:02.000Z",
      finishedAt: "1999-12-31T00:00:08.000Z",
    };
    const liveNodes: LiveSubagentNode[] = [
      {
        agentId: "agent-alice",
        sessionId: "session-parent",
        parentAgentId: null,
        agentType: "Explore",
        description: "Live description",
        startedAt: "1999-12-31T00:00:00.000Z",
        endedAt: null,
      },
      {
        agentId: "agent-bob",
        sessionId: "session-parent",
        parentAgentId: "agent-alice",
        agentType: "Explore",
        description: "Live child",
        startedAt: "1999-12-31T00:00:03.000Z",
        endedAt: null,
      },
    ];

    expect(mergeLiveSubagents([indexed], liveNodes)).toStrictEqual([
      indexed,
      {
        id: "agent-bob",
        sessionId: "session-parent",
        projectId: "project-example",
        parentAgentId: "agent-alice",
        agentType: "Explore",
        attributionAgent: null,
        slug: null,
        description: "Live child",
        model: null,
        startedAt: "1999-12-31T00:00:03.000Z",
        finishedAt: null,
      },
    ]);
  });
});
