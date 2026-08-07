import { describe, it, expect } from "vite-plus/test";
import { QueryClient } from "@tanstack/react-query";
import {
  applyMemoryChanged,
  applyMemoryRemoved,
  applyNotificationAdded,
  applyNotificationCleared,
  applyPlanChanged,
  applyPlanRemoved,
  applySessionAdded,
  applySessionLinesAppended,
  applySessionRemoved,
  applySessionUpdated,
  applyTaskChanged,
  claudeEventsReducer,
  type ClaudeEventsState,
  type ClaudeEventsAction,
} from "../src/hooks/use-claude-events";
import {
  DOMAIN_EVENTS,
  type MemorySummaryPayload,
  type NotificationEntryPayload,
  type PlanSummaryPayload,
  type SessionSummaryPayload,
} from "../src/lib/hook-events";
import {
  sessionQueryKeys,
  transcriptQueryOptions,
  type TranscriptData,
} from "../src/lib/api/sessions";
import type { LiveSubagentNode } from "../src/lib/live-subagent-store";

function makeSession(
  overrides: Partial<SessionSummaryPayload> & { id: string; project: string },
): SessionSummaryPayload {
  const { id, project, ...rest } = overrides;
  return {
    id,
    title: `Session ${id}`,
    summary: undefined,
    mtime: "1999-12-31T00:00:00.000Z",
    created: "1999-12-31T00:00:00.000Z",
    project,
    projectName: `Project ${project}`,
    messageCount: 0,
    gitBranch: undefined,
    starred: false,
    state: "unknown",
    blockedSince: null,
    ...rest,
  };
}

function makePlan(filename: string, title = filename): PlanSummaryPayload {
  return { filename, title, mtime: "1999-12-31T00:00:00.000Z" };
}

function makeMemory(project: string, filename: string, title = filename): MemorySummaryPayload {
  return {
    filename,
    title,
    mtime: "1999-12-31T00:00:00.000Z",
    project,
    projectName: `Project ${project}`,
  };
}

function makeInitialState(): ClaudeEventsState {
  return {
    activeSessions: new Map(),
    hookContexts: new Map(),
    hookSchemaDrifts: new Map(),
    dismissedDrifts: new Set(),
    pendingTools: new Map(),
    failedTools: new Map(),
    compactingSessions: new Set(),
    notifications: new Map(),
    runningSubagents: new Map(),
    liveSubagents: new Map(),
  };
}

describe("claudeEventsReducer", () => {
  it("merges live turn context and clears paused work for the next prompt", () => {
    const paused = claudeEventsReducer(makeInitialState(), {
      type: "SSE_EVENT",
      eventType: DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED,
      data: {
        sessionId: "session-test-100",
        sessionTitle: "Test session",
        promptId: "prompt-test-100",
        permissionMode: "auto",
        effortLevel: "high",
        backgroundTasks: [
          {
            id: "task-test-100",
            type: "agent",
            status: "running",
            description: "Inspect the example project",
          },
        ],
        sessionCrons: [
          {
            id: "cron-test-100",
            schedule: "0 * * * *",
            recurring: true,
            prompt: "Check the example service",
          },
        ],
      },
      timestamp: 1_000,
    });

    const resumed = claudeEventsReducer(paused, {
      type: "SSE_EVENT",
      eventType: DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED,
      data: {
        sessionId: "session-test-100",
        promptId: "prompt-test-200",
        permissionMode: "",
        effortLevel: "",
        backgroundTasks: [],
        sessionCrons: [],
      },
      timestamp: 2_000,
    });

    expect(resumed.hookContexts).toStrictEqual(
      new Map([
        [
          "session-test-100",
          {
            sessionId: "session-test-100",
            sessionTitle: "Test session",
            promptId: "prompt-test-200",
            permissionMode: "",
            effortLevel: "",
            backgroundTasks: [],
            sessionCrons: [],
          },
        ],
      ]),
    );
  });

  it("hydrates running and recently-ended nodes from the SSE snapshot", () => {
    const runningNode: LiveSubagentNode = {
      sessionId: "session-test",
      parentAgentId: null,
      agentType: "Explore",
      agentId: "agent-alice",
      description: "Inspect the test project",
      startedAt: "1999-12-31T00:00:00.000Z",
      endedAt: null,
    };
    const endedNode: LiveSubagentNode = {
      sessionId: "session-test",
      parentAgentId: "agent-alice",
      agentType: "Plan",
      agentId: "agent-bob",
      description: "Plan the test change",
      startedAt: "1999-12-31T00:00:01.000Z",
      endedAt: "1999-12-31T00:00:02.000Z",
    };

    const state = claudeEventsReducer(makeInitialState(), {
      type: "SSE_EVENT",
      eventType: DOMAIN_EVENTS.SUBAGENTS_SNAPSHOT,
      data: { subagents: [runningNode, endedNode] },
      timestamp: 1_000,
    });

    expect({
      liveSubagents: state.liveSubagents,
      runningSubagents: state.runningSubagents,
    }).toStrictEqual({
      liveSubagents: new Map([
        ["agent-alice", runningNode],
        ["agent-bob", endedNode],
      ]),
      runningSubagents: new Map([["session-test:alice", runningNode]]),
    });
  });

  it("tracks a subagent from start through stop", () => {
    const started = claudeEventsReducer(makeInitialState(), {
      type: "SSE_EVENT",
      eventType: DOMAIN_EVENTS.SUBAGENT_STARTED,
      data: {
        sessionId: "session-test",
        agentType: "Explore",
        agentId: "test-agent",
        description: "Inspect test behavior",
      },
      timestamp: 1_000,
    });
    const startedNode = {
      sessionId: "session-test",
      parentAgentId: null,
      agentType: "Explore",
      agentId: "agent-test-agent",
      description: "Inspect test behavior",
      startedAt: "1970-01-01T00:00:01.000Z",
      endedAt: null,
    };
    expect({
      runningSubagents: started.runningSubagents,
      liveSubagents: started.liveSubagents,
    }).toStrictEqual({
      runningSubagents: new Map([["session-test:test-agent", startedNode]]),
      liveSubagents: new Map([["agent-test-agent", startedNode]]),
    });

    const stopped = claudeEventsReducer(started, {
      type: "SSE_EVENT",
      eventType: DOMAIN_EVENTS.SUBAGENT_STOPPED,
      data: {
        sessionId: "session-test",
        agentType: "Explore",
        agentId: "agent-test-agent",
      },
      timestamp: 2_000,
    });
    expect({
      runningSubagents: stopped.runningSubagents,
      liveSubagents: stopped.liveSubagents,
    }).toStrictEqual({
      runningSubagents: new Map(),
      liveSubagents: new Map([
        [
          "agent-test-agent",
          {
            ...startedNode,
            endedAt: "1970-01-01T00:00:02.000Z",
          },
        ],
      ]),
    });
  });

  it("handles session:start by adding to activeSessions", () => {
    const state = makeInitialState();
    const action: ClaudeEventsAction = {
      type: "SSE_EVENT",
      eventType: "session:start",
      data: { sessionId: "abc-123", cwd: "/home/user/project", model: "opus" },
      timestamp: 1000,
    };
    const next = claudeEventsReducer(state, action);
    expect(next.activeSessions.has("abc-123")).toBe(true);
    expect(next.activeSessions.get("abc-123")).toStrictEqual({
      sessionId: "abc-123",
      cwd: "/home/user/project",
      model: "opus",
      startedAt: 1000,
      lastActivity: 1000,
    });
  });

  it("handles session:end by removing from activeSessions", () => {
    const state = makeInitialState();
    state.activeSessions.set("abc-123", {
      sessionId: "abc-123",
      cwd: "/home/user/project",
      model: "opus",
      startedAt: 1000,
      lastActivity: 1000,
    });
    const action: ClaudeEventsAction = {
      type: "SSE_EVENT",
      eventType: "session:end",
      data: { sessionId: "abc-123" },
      timestamp: 2000,
    };
    const next = claudeEventsReducer(state, action);
    expect(next.activeSessions.has("abc-123")).toBe(false);
  });

  it("handles domain session:updated by touching lastActivity via the session payload id", () => {
    const state = makeInitialState();
    state.activeSessions.set("abc-123", {
      sessionId: "abc-123",
      cwd: "/home/user/project",
      model: "opus",
      startedAt: 1000,
      lastActivity: 1000,
    });
    const action: ClaudeEventsAction = {
      type: "SSE_EVENT",
      eventType: "session:updated",
      data: { session: { id: "abc-123" } },
      timestamp: 3000,
    };
    const next = claudeEventsReducer(state, action);
    expect(next.activeSessions.get("abc-123")?.lastActivity).toBe(3000);
  });

  it("ignores non-lifecycle events without mutating state", () => {
    const state = makeInitialState();
    const action: ClaudeEventsAction = {
      type: "SSE_EVENT",
      eventType: "task:changed",
      data: { taskId: "task-1" },
      timestamp: 5000,
    };
    const next = claudeEventsReducer(state, action);
    expect(next).toBe(state);
  });

  it("does not mutate the original state", () => {
    const state = makeInitialState();
    const action: ClaudeEventsAction = {
      type: "SSE_EVENT",
      eventType: "session:start",
      data: { sessionId: "abc-123", cwd: "/tmp" },
      timestamp: 1000,
    };
    const next = claudeEventsReducer(state, action);
    expect(state.activeSessions.size).toBe(0);
    expect(next.activeSessions.size).toBe(1);
  });

  it("session:updated for unknown session does not add it", () => {
    const state = makeInitialState();
    const action: ClaudeEventsAction = {
      type: "SSE_EVENT",
      eventType: "session:updated",
      data: { session: { id: "unknown-id" } },
      timestamp: 1000,
    };
    const next = claudeEventsReducer(state, action);
    expect(next.activeSessions.has("unknown-id")).toBe(false);
  });

  it("handles RESET action", () => {
    const state = makeInitialState();
    state.activeSessions.set("abc-123", {
      sessionId: "abc-123",
      cwd: "/tmp",
      model: "",
      startedAt: 1000,
      lastActivity: 1000,
    });
    const action: ClaudeEventsAction = { type: "RESET" };
    const next = claudeEventsReducer(state, action);
    expect(next.activeSessions.size).toBe(0);
    expect(next.hookSchemaDrifts.size).toBe(0);
    expect(next.dismissedDrifts.size).toBe(0);
  });

  it("records session:tool-failed payloads into failedTools keyed by sessionId:toolUseId", () => {
    const state = makeInitialState();
    const action: ClaudeEventsAction = {
      type: "SSE_EVENT",
      eventType: "session:tool-failed",
      data: {
        sessionId: "abc-123",
        toolName: "Bash",
        toolUseId: "toolu_fail_01",
        error: "exit 1",
      },
      timestamp: 5000,
    };
    const next = claudeEventsReducer(state, action);
    expect(next.failedTools.get("abc-123:toolu_fail_01")).toStrictEqual({
      sessionId: "abc-123",
      toolName: "Bash",
      toolUseId: "toolu_fail_01",
      error: "exit 1",
    });
  });

  it("session:tool-failed clears matching pending tool indicator", () => {
    const state = makeInitialState();
    state.pendingTools.set("abc-123", {
      sessionId: "abc-123",
      toolName: "Bash",
      toolUseId: "toolu_fail_01",
    });
    const next = claudeEventsReducer(state, {
      type: "SSE_EVENT",
      eventType: "session:tool-failed",
      data: {
        sessionId: "abc-123",
        toolName: "Bash",
        toolUseId: "toolu_fail_01",
        error: "boom",
      },
      timestamp: 6000,
    });
    expect(next.pendingTools.has("abc-123")).toBe(false);
    expect(next.failedTools.get("abc-123:toolu_fail_01")?.error).toBe("boom");
  });

  it("records hook:schema-drift payloads keyed by hookEventName", () => {
    const state = makeInitialState();
    const action: ClaudeEventsAction = {
      type: "SSE_EVENT",
      eventType: "hook:schema-drift",
      data: {
        hookEventName: "PostToolUse",
        missingFields: ["tool_response.foo"],
        unknownFields: ["tool_input.experimental_flag"],
        count: 3,
      },
      timestamp: 5000,
    };
    const next = claudeEventsReducer(state, action);
    expect(next.hookSchemaDrifts.get("PostToolUse")).toStrictEqual({
      hookEventName: "PostToolUse",
      missingFields: ["tool_response.foo"],
      unknownFields: ["tool_input.experimental_flag"],
      count: 3,
    });
  });

  it("DISMISS_DRIFT hides the named drift until a fresh one arrives", () => {
    const state = makeInitialState();
    state.hookSchemaDrifts.set("PostToolUse", {
      hookEventName: "PostToolUse",
      missingFields: [],
      unknownFields: ["x"],
      count: 1,
    });
    const dismissed = claudeEventsReducer(state, {
      type: "DISMISS_DRIFT",
      hookEventName: "PostToolUse",
    });
    expect(dismissed.dismissedDrifts.has("PostToolUse")).toBe(true);

    // A new drift for the same event clears the dismissal.
    const next = claudeEventsReducer(dismissed, {
      type: "SSE_EVENT",
      eventType: "hook:schema-drift",
      data: {
        hookEventName: "PostToolUse",
        missingFields: [],
        unknownFields: ["y"],
        count: 2,
      },
      timestamp: 6000,
    });
    expect(next.dismissedDrifts.has("PostToolUse")).toBe(false);
  });
});

describe("applySessionAdded", () => {
  it("invalidates every registered session-list shape", () => {
    const queryClient = new QueryClient();
    const groupedKey = sessionQueryKeys.grouped();
    const recentKey = sessionQueryKeys.recent(20);
    const recentInfiniteKey = sessionQueryKeys.recentInfinite();
    queryClient.setQueryData(groupedKey, []);
    queryClient.setQueryData(recentKey, { sessions: [], nextCursor: null });
    queryClient.setQueryData(recentInfiniteKey, { pages: [], pageParams: [] });

    applySessionAdded(queryClient, makeSession({ id: "new", project: "proj-a" }));

    expect([
      queryClient.getQueryState(groupedKey)?.isInvalidated,
      queryClient.getQueryState(recentKey)?.isInvalidated,
      queryClient.getQueryState(recentInfiniteKey)?.isInvalidated,
    ]).toStrictEqual([true, true, true]);
  });

  it("invalidates all plan link queries", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["plans", "plan-a.md", "links"], [{ sessionId: "s1" }]);
    queryClient.setQueryData(["plans", "plan-b.md", "links"], [{ sessionId: "s2" }]);
    queryClient.setQueryData(["plans", "plan-a.md"], { content: "keep" });

    applySessionAdded(queryClient, makeSession({ id: "new-1", project: "proj-a" }));

    expect(queryClient.getQueryState(["plans", "plan-a.md", "links"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["plans", "plan-b.md", "links"])?.isInvalidated).toBe(true);
    // Plan detail should not be invalidated by session addition.
    expect(queryClient.getQueryState(["plans", "plan-a.md"])?.isInvalidated).toBe(false);
  });
});

describe("applySessionRemoved", () => {
  it("invalidates every registered session-list shape", () => {
    const queryClient = new QueryClient();
    const groupedKey = sessionQueryKeys.grouped();
    const recentKey = sessionQueryKeys.recent(20);
    const recentInfiniteKey = sessionQueryKeys.recentInfinite();
    queryClient.setQueryData(groupedKey, []);
    queryClient.setQueryData(recentKey, { sessions: [], nextCursor: null });
    queryClient.setQueryData(recentInfiniteKey, { pages: [], pageParams: [] });

    applySessionRemoved(queryClient, "a1", "proj-a");

    expect([
      queryClient.getQueryState(groupedKey)?.isInvalidated,
      queryClient.getQueryState(recentKey)?.isInvalidated,
      queryClient.getQueryState(recentInfiniteKey)?.isInvalidated,
    ]).toStrictEqual([true, true, true]);
  });

  it("invalidates the factory-keyed session subtree without removing data", () => {
    const queryClient = new QueryClient();
    const detailKey = sessionQueryKeys.detail("a1");
    const transcriptKey = sessionQueryKeys.transcript("a1");
    const subagentsKey = sessionQueryKeys.subagents("a1");
    const unrelatedDetailKey = sessionQueryKeys.detail("a2");
    queryClient.setQueryData(detailKey, { id: "a1" });
    queryClient.setQueryData(transcriptKey, { records: [], byteOffset: 0 });
    queryClient.setQueryData(subagentsKey, [{ name: "planner" }]);
    queryClient.setQueryData(unrelatedDetailKey, { id: "a2" });

    applySessionRemoved(queryClient, "a1", "proj-a");

    expect({
      detail: queryClient.getQueryData(detailKey),
      detailInvalidated: queryClient.getQueryState(detailKey)?.isInvalidated,
      subagents: queryClient.getQueryData(subagentsKey),
      subagentsInvalidated: queryClient.getQueryState(subagentsKey)?.isInvalidated,
      transcript: queryClient.getQueryData(transcriptKey),
      transcriptInvalidated: queryClient.getQueryState(transcriptKey)?.isInvalidated,
      unrelatedDetail: queryClient.getQueryData(unrelatedDetailKey),
      unrelatedDetailInvalidated: queryClient.getQueryState(unrelatedDetailKey)?.isInvalidated,
    }).toStrictEqual({
      detail: { id: "a1" },
      detailInvalidated: true,
      subagents: [{ name: "planner" }],
      subagentsInvalidated: true,
      transcript: { records: [], byteOffset: 0 },
      transcriptInvalidated: true,
      unrelatedDetail: { id: "a2" },
      unrelatedDetailInvalidated: false,
    });
  });
});

describe("applySessionUpdated", () => {
  it("invalidates every registered session-list shape", () => {
    const queryClient = new QueryClient();
    const groupedKey = sessionQueryKeys.grouped();
    const recentKey = sessionQueryKeys.recent(20);
    const recentInfiniteKey = sessionQueryKeys.recentInfinite();
    queryClient.setQueryData(groupedKey, []);
    queryClient.setQueryData(recentKey, { sessions: [], nextCursor: null });
    queryClient.setQueryData(recentInfiniteKey, { pages: [], pageParams: [] });

    applySessionUpdated(queryClient, makeSession({ id: "a1", project: "proj-a", title: "New" }));

    expect([
      queryClient.getQueryState(groupedKey)?.isInvalidated,
      queryClient.getQueryState(recentKey)?.isInvalidated,
      queryClient.getQueryState(recentInfiniteKey)?.isInvalidated,
    ]).toStrictEqual([true, true, true]);
  });

  it("invalidates session detail without invalidating its transcript", () => {
    const queryClient = new QueryClient();
    const detailKey = sessionQueryKeys.detail("a1");
    const transcriptKey = sessionQueryKeys.transcript("a1");
    queryClient.setQueryData(detailKey, { title: "Old" });
    queryClient.setQueryData(transcriptKey, { records: [], byteOffset: 0 });

    applySessionUpdated(queryClient, makeSession({ id: "a1", project: "proj-a", title: "New" }));

    expect({
      detailInvalidated: queryClient.getQueryState(detailKey)?.isInvalidated,
      transcriptInvalidated: queryClient.getQueryState(transcriptKey)?.isInvalidated,
    }).toStrictEqual({
      detailInvalidated: true,
      transcriptInvalidated: false,
    });
  });
});

describe("applyPlanChanged", () => {
  it("invalidates the flat plans list so it refetches with up-to-date project links", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["plans"], [makePlan("a.md")]);

    applyPlanChanged(queryClient, makePlan("a.md", "Updated"));

    const plansState = queryClient.getQueryState(["plans"]);
    expect(plansState?.isInvalidated).toBe(true);
  });

  it("invalidates plan detail and links queries keyed by the URL slug", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["plans"], [makePlan("a.md")]);
    // planQueryOptions/planLinksQueryOptions key by the slug, not the filename.
    queryClient.setQueryData(["plans", "a"], {
      markdown: "old",
      mtime: null,
      title: "old",
    });
    queryClient.setQueryData(["plans", "a", "links"], []);

    applyPlanChanged(queryClient, makePlan("a.md", "Updated"));

    const detailState = queryClient.getQueryState(["plans", "a"]);
    const linksState = queryClient.getQueryState(["plans", "a", "links"]);
    expect(detailState?.isInvalidated).toBe(true);
    expect(linksState?.isInvalidated).toBe(true);
  });
});

describe("applyPlanRemoved", () => {
  it("invalidates the flat plans list and removes the slug-keyed detail caches", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["plans"], [makePlan("a.md"), makePlan("b.md")]);
    // planQueryOptions/planLinksQueryOptions key by the slug, not the filename.
    queryClient.setQueryData(["plans", "a"], {
      markdown: "a",
      mtime: null,
      title: "a",
    });
    queryClient.setQueryData(["plans", "a", "links"], []);

    applyPlanRemoved(queryClient, "a.md");

    const plansState = queryClient.getQueryState(["plans"]);
    expect(plansState?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(["plans", "a"])).toBeUndefined();
    expect(queryClient.getQueryData(["plans", "a", "links"])).toBeUndefined();
  });
});

describe("applyMemoryChanged", () => {
  it("invalidates the project memory list and per-memory detail caches", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["projects", "proj-a", "memories"], {
      project: { id: "proj-a", name: "Project A", projectPath: null },
      memories: [],
    });
    // memoryDetailQueryOptions keys by the slug, not the filename.
    queryClient.setQueryData(["projects", "proj-a", "memories", "MEMORY"], {
      markdown: "old",
      mtime: null,
      projectName: "Project A",
    });

    applyMemoryChanged(queryClient, makeMemory("proj-a", "MEMORY.md", "Updated"));

    const listState = queryClient.getQueryState(["projects", "proj-a", "memories"]);
    const detailState = queryClient.getQueryState(["projects", "proj-a", "memories", "MEMORY"]);
    expect(listState?.isInvalidated).toBe(true);
    expect(detailState?.isInvalidated).toBe(true);
  });
});

describe("applyMemoryRemoved", () => {
  it("invalidates the project memory list and evicts the per-memory cache", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["projects", "proj-a", "memories"], {
      project: { id: "proj-a", name: "Project A", projectPath: null },
      memories: [],
    });
    // memoryDetailQueryOptions keys by the slug, not the filename.
    queryClient.setQueryData(["projects", "proj-a", "memories", "MEMORY"], {
      markdown: "old",
      mtime: null,
      projectName: "Project A",
    });
    queryClient.setQueryData(["projects", "proj-b", "memories", "OTHER"], {
      markdown: "keep",
      mtime: null,
      projectName: "Project B",
    });

    applyMemoryRemoved(queryClient, "proj-a", "MEMORY.md");

    const listState = queryClient.getQueryState(["projects", "proj-a", "memories"]);
    expect(listState?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(["projects", "proj-a", "memories", "MEMORY"])).toBeUndefined();
    expect(queryClient.getQueryData(["projects", "proj-b", "memories", "OTHER"])).toStrictEqual({
      markdown: "keep",
      mtime: null,
      projectName: "Project B",
    });
  });

  it("is a no-op when the memories query has never been populated", () => {
    const queryClient = new QueryClient();
    applyMemoryRemoved(queryClient, "proj-a", "MEMORY.md");
    expect(queryClient.getQueryData(["projects", "proj-a", "memories"])).toBeUndefined();
  });
});

describe("applyTaskChanged", () => {
  it("invalidates both the global and per-project task queries", () => {
    const queryClient = new QueryClient();
    // Prime two task queries.
    queryClient.setQueryData(["tasks"], []);
    queryClient.setQueryData(["tasks", "project", "proj-a"], []);

    applyTaskChanged(queryClient, "proj-a");

    const globalState = queryClient.getQueryState(["tasks"]);
    const projectState = queryClient.getQueryState(["tasks", "project", "proj-a"]);
    expect(globalState?.isInvalidated).toBe(true);
    expect(projectState?.isInvalidated).toBe(true);
  });
});

function makeNotification(
  overrides: Partial<NotificationEntryPayload> & {
    id: string;
    projectId: string;
  },
): NotificationEntryPayload {
  const { id, projectId, ...rest } = overrides;
  return {
    id,
    sessionId: `sess-${id}`,
    projectId,
    projectName: `Project ${projectId}`,
    message: `Message ${id}`,
    title: undefined,
    notificationType: "agent_needs_input",
    createdAt: 1_000,
    createdAtIso: "1999-12-31T00:00:00.000Z",
    ...rest,
  };
}

type NotificationsData = {
  notifications: Array<NotificationEntryPayload & { unread: boolean }>;
};

describe("applyNotificationAdded", () => {
  it("prepends the new notification newest-first into both the global and per-project slices", () => {
    const queryClient = new QueryClient();
    const existing = makeNotification({ id: "old", projectId: "proj-a" });
    queryClient.setQueryData<NotificationsData>(["notifications"], {
      notifications: [{ ...existing, unread: false }],
    });
    queryClient.setQueryData<NotificationsData>(["notifications", "proj-a"], {
      notifications: [{ ...existing, unread: false }],
    });

    applyNotificationAdded(queryClient, makeNotification({ id: "new", projectId: "proj-a" }));

    const global = queryClient.getQueryData<NotificationsData>(["notifications"]);
    const scoped = queryClient.getQueryData<NotificationsData>(["notifications", "proj-a"]);
    expect(global?.notifications.map(({ id, unread }) => ({ id, unread }))).toStrictEqual([
      { id: "new", unread: true },
      { id: "old", unread: false },
    ]);
    expect(scoped?.notifications.map(({ id, unread }) => ({ id, unread }))).toStrictEqual([
      { id: "new", unread: true },
      { id: "old", unread: false },
    ]);
  });

  it("replaces an existing entry with the same id and moves it to the front", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<NotificationsData>(["notifications"], {
      notifications: [
        {
          ...makeNotification({ id: "a", projectId: "proj-a", message: "old text" }),
          unread: false,
        },
        { ...makeNotification({ id: "b", projectId: "proj-a" }), unread: false },
      ],
    });

    applyNotificationAdded(
      queryClient,
      makeNotification({ id: "a", projectId: "proj-a", message: "new text" }),
    );

    const global = queryClient.getQueryData<NotificationsData>(["notifications"]);
    expect(
      global?.notifications.map(({ id, message, unread }) => ({ id, message, unread })),
    ).toStrictEqual([
      { id: "a", message: "new text", unread: true },
      { id: "b", message: "Message b", unread: false },
    ]);
  });

  it("is a no-op when a slice has never been populated", () => {
    const queryClient = new QueryClient();
    applyNotificationAdded(queryClient, makeNotification({ id: "x", projectId: "proj-a" }));
    expect(queryClient.getQueryData(["notifications"])).toBeUndefined();
    expect(queryClient.getQueryData(["notifications", "proj-a"])).toBeUndefined();
  });
});

describe("applyNotificationCleared", () => {
  it("removes a single id from every matching slice", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<NotificationsData>(["notifications"], {
      notifications: [
        { ...makeNotification({ id: "a", projectId: "proj-a" }), unread: true },
        { ...makeNotification({ id: "b", projectId: "proj-b" }), unread: false },
      ],
    });
    queryClient.setQueryData<NotificationsData>(["notifications", "proj-a"], {
      notifications: [{ ...makeNotification({ id: "a", projectId: "proj-a" }), unread: true }],
    });

    applyNotificationCleared(queryClient, { id: "a" });

    expect(
      queryClient
        .getQueryData<NotificationsData>(["notifications"])
        ?.notifications.map((n) => n.id),
    ).toStrictEqual(["b"]);
    expect(
      queryClient.getQueryData<NotificationsData>(["notifications", "proj-a"])?.notifications,
    ).toStrictEqual([]);
  });

  it("empties every slice when all:true", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<NotificationsData>(["notifications"], {
      notifications: [
        { ...makeNotification({ id: "a", projectId: "proj-a" }), unread: true },
        { ...makeNotification({ id: "b", projectId: "proj-b" }), unread: false },
      ],
    });
    queryClient.setQueryData<NotificationsData>(["notifications", "proj-a"], {
      notifications: [{ ...makeNotification({ id: "a", projectId: "proj-a" }), unread: true }],
    });

    applyNotificationCleared(queryClient, { all: true });

    expect(
      queryClient.getQueryData<NotificationsData>(["notifications"])?.notifications,
    ).toStrictEqual([]);
    expect(
      queryClient.getQueryData<NotificationsData>(["notifications", "proj-a"])?.notifications,
    ).toStrictEqual([]);
  });
});

// -----------------------------------------------------------------------
// applySessionLinesAppended
// -----------------------------------------------------------------------

function makeTranscriptCache(overrides?: Partial<TranscriptData>): TranscriptData {
  return {
    records: [],
    byteOffset: 0,
    ...overrides,
  };
}

describe("applySessionLinesAppended", () => {
  it("ignores event when no cached data exists for the session", () => {
    const queryClient = new QueryClient();
    applySessionLinesAppended(queryClient, "sess-1", {
      sessionId: "sess-1",
      lines: [
        {
          type: "assistant",
          uuid: "a-1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hi" }],
          },
        },
      ],
    });
    expect(queryClient.getQueryData(sessionQueryKeys.transcript("sess-1"))).toBeUndefined();
  });

  it("appends new raw records to cached transcript data", () => {
    const queryClient = new QueryClient();
    const existingRecord = {
      type: "user",
      uuid: "u-1",
      message: { role: "user", content: "hello" },
    };
    queryClient.setQueryData(
      sessionQueryKeys.transcript("sess-1"),
      makeTranscriptCache({ records: [existingRecord], byteOffset: 100 }),
    );

    const newRecord = {
      type: "assistant",
      uuid: "a-1",
      timestamp: "1999-12-31T00:00:00Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "response" }],
      },
    };
    applySessionLinesAppended(queryClient, "sess-1", {
      sessionId: "sess-1",
      lines: [newRecord],
    });

    const cached = queryClient.getQueryData<TranscriptData>(sessionQueryKeys.transcript("sess-1"))!;
    expect(cached).toStrictEqual({
      records: [existingRecord, newRecord],
      byteOffset: 100,
    });
  });

  it("does not modify cache when lines array is empty", () => {
    const queryClient = new QueryClient();
    const original = makeTranscriptCache({ byteOffset: 50 });
    queryClient.setQueryData(sessionQueryKeys.transcript("sess-1"), original);

    applySessionLinesAppended(queryClient, "sess-1", {
      sessionId: "sess-1",
      lines: [],
    });

    const cached = queryClient.getQueryData<TranscriptData>(sessionQueryKeys.transcript("sess-1"))!;
    expect(cached).toBe(original);
  });

  it("appends all record types including non-user/assistant", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      sessionQueryKeys.transcript("sess-1"),
      makeTranscriptCache({ byteOffset: 50 }),
    );

    const records = [
      { type: "progress", uuid: "p-1" },
      {
        type: "assistant",
        uuid: "a-1",
        message: { role: "assistant", content: "hi" },
      },
    ];
    applySessionLinesAppended(queryClient, "sess-1", {
      sessionId: "sess-1",
      lines: records,
    });

    const cached = queryClient.getQueryData<TranscriptData>(sessionQueryKeys.transcript("sess-1"))!;
    expect(cached).toStrictEqual({
      records,
      byteOffset: 50,
    });
  });

  it("preserves an appended line when an older in-flight refetch resolves afterward", async () => {
    const queryClient = new QueryClient();
    const queryKey = sessionQueryKeys.transcript("session-test-100");
    const existingRecord = {
      type: "user",
      uuid: "user-test-100",
      message: { role: "user", content: "hello" },
    };
    const appendedRecord = {
      type: "assistant",
      uuid: "assistant-test-100",
      message: { role: "assistant", content: "response" },
    };
    queryClient.setQueryData(
      queryKey,
      makeTranscriptCache({ records: [existingRecord], byteOffset: 100 }),
    );
    let resolveRefetch: () => void = () => undefined;
    const responseReady = new Promise<void>((resolve) => {
      resolveRefetch = resolve;
    });
    const refetch = queryClient.fetchQuery({
      ...transcriptQueryOptions("session-test-100"),
      staleTime: 0,
      queryFn: async () => {
        await responseReady;
        return makeTranscriptCache({ records: [existingRecord], byteOffset: 100 });
      },
    });

    applySessionLinesAppended(queryClient, "session-test-100", {
      sessionId: "session-test-100",
      lines: [appendedRecord],
    });
    resolveRefetch();
    await refetch;

    expect(queryClient.getQueryData<TranscriptData>(queryKey)).toStrictEqual({
      records: [existingRecord, appendedRecord],
      byteOffset: 100,
    });
  });

  it("does not duplicate a line appended after a refetch already returned it", async () => {
    const queryClient = new QueryClient();
    const queryKey = sessionQueryKeys.transcript("session-test-100");
    const existingRecord = {
      type: "user",
      uuid: "user-test-100",
      message: { role: "user", content: "hello" },
    };
    const appendedRecord = {
      type: "assistant",
      uuid: "assistant-test-100",
      message: { role: "assistant", content: "response" },
    };
    queryClient.setQueryData(
      queryKey,
      makeTranscriptCache({ records: [existingRecord], byteOffset: 100 }),
    );

    await queryClient.fetchQuery({
      ...transcriptQueryOptions("session-test-100"),
      staleTime: 0,
      queryFn: async () =>
        makeTranscriptCache({ records: [existingRecord, appendedRecord], byteOffset: 200 }),
    });
    applySessionLinesAppended(queryClient, "session-test-100", {
      sessionId: "session-test-100",
      lines: [appendedRecord],
    });

    expect(queryClient.getQueryData<TranscriptData>(queryKey)).toStrictEqual({
      records: [existingRecord, appendedRecord],
      byteOffset: 200,
    });
  });
});
