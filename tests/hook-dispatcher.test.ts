import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vite-plus/test";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { indexSessionsIndex } from "../src/lib/db/indexer";
import { dispatchHookEvent } from "../src/lib/hook-dispatcher";
import { DOMAIN_EVENTS, SSE_EVENTS } from "../src/lib/hook-events";
import type { HookEvent } from "../src/lib/hook-events";
import { getNotifications, clearAllNotifications } from "../src/lib/notifications-store";
import { clearLiveSubagents } from "../src/lib/live-subagent-store";
import * as schema from "../src/lib/db/schema";
import type { ActiveSessionEntry } from "../src/lib/active-session-store";
import type { ActivityState } from "../src/lib/session-state";
import {
  getPendingApprovals,
  initPendingApprovalsCache,
} from "../src/lib/db/pending-approvals-cache";

const testDir = join(tmpdir(), "claude-hook-dispatcher-test-" + process.pid);
let db: AppDb;

type Broadcast = { type: string; data: Record<string, unknown> };

function makeSessionsIndex(entries: Record<string, unknown>[]): string {
  return JSON.stringify({ version: 1, entries });
}

type StoreMeta = {
  cwd: string;
  model?: string;
  claudeEnv?: Record<string, string>;
};

function makeStore() {
  const activeCalls: Array<{ sessionId: string; meta: StoreMeta }> = [];
  const endedCalls: string[] = [];
  const stateCalls: Array<{ sessionId: string; state: ActivityState }> = [];
  const touchedCalls: string[] = [];
  const touchCalls: Array<{
    sessionId: string;
    meta?: { claudeEnv?: Record<string, string> };
  }> = [];
  return {
    activeCalls,
    endedCalls,
    stateCalls,
    touchedCalls,
    touchCalls,
    store: {
      markSessionActive: (sessionId: string, meta: StoreMeta) => {
        activeCalls.push({ sessionId, meta });
      },
      markSessionEnded: (sessionId: string) => {
        endedCalls.push(sessionId);
      },
      setSessionState: (sessionId: string, state: ActivityState) => {
        stateCalls.push({ sessionId, state });
      },
      touchSession: (sessionId: string, meta?: { claudeEnv?: Record<string, string> }) => {
        touchedCalls.push(sessionId);
        touchCalls.push(meta === undefined ? { sessionId } : { sessionId, meta });
      },
      getActiveSessionEntry: (sessionId: string) => {
        const call = activeCalls.find((c) => c.sessionId === sessionId);
        if (!call) return null;
        return {
          sessionId,
          state:
            [...stateCalls].reverse().find((stateCall) => stateCall.sessionId === sessionId)
              ?.state ?? "unknown",
          cwd: call.meta.cwd,
          model: call.meta.model ?? "",
          startedAt: 946_598_400_000,
          lastActivity: 946_598_400_000,
          claudeEnv: call.meta.claudeEnv ?? {},
          tmuxPane: call.meta.claudeEnv?.["TMUX_PANE"] ?? "",
          tmuxServerSocket: call.meta.claudeEnv?.["TMUX"]?.split(",")[0] ?? "",
          herdrPane: call.meta.claudeEnv?.["HERDR_PANE_ID"] ?? "",
          herdrWorkspace: call.meta.claudeEnv?.["HERDR_WORKSPACE_ID"] ?? "",
          herdrSocketPath: call.meta.claudeEnv?.["HERDR_SOCKET_PATH"] ?? "",
        };
      },
    },
  };
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
  db = openTestDb();
  clearLiveSubagents();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearLiveSubagents();
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe("dispatchHookEvent", () => {
  it("SessionStart broadcasts both legacy SESSION_START and domain SESSION_STARTED with full payload", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, activeCalls } = makeStore();
    const event: HookEvent = {
      hook_event_name: "SessionStart",
      session_id: "abc-123",
      transcript_path: "/Users/u/.claude/projects/-h-u-p/abc-123.jsonl",
      cwd: "/home/user/project",
      model: "claude-sonnet-4-6",
      source: "startup",
      session_title: "Test hook session",
      prompt_id: "prompt-test-100",
      permission_mode: "auto",
      effort: { level: "high" },
    };

    await dispatchHookEvent({
      event,
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(activeCalls).toStrictEqual([
      {
        sessionId: "abc-123",
        meta: { cwd: "/home/user/project", model: "claude-sonnet-4-6" },
      },
    ]);
    const legacy = broadcasts.find((b) => b.type === SSE_EVENTS.SESSION_START);
    if (!legacy) throw new Error("Expected legacy broadcast");
    expect(legacy.data).toStrictEqual({
      sessionId: "abc-123",
      cwd: "/home/user/project",
      model: "claude-sonnet-4-6",
    });
    const domain = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_STARTED);
    if (!domain) throw new Error("Expected domain broadcast");
    expect(domain.data).toStrictEqual({
      session: {
        sessionId: "abc-123",
        cwd: "/home/user/project",
        model: "claude-sonnet-4-6",
        startedAt: 946_598_400_000,
        lastActivity: 946_598_400_000,
      },
    });
    const context = broadcasts.find(
      (broadcast) => broadcast.type === DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED,
    );
    if (!context) throw new Error("Expected session:hook-context-changed broadcast");
    expect(context.data).toStrictEqual({
      sessionId: "abc-123",
      sessionTitle: "Test hook session",
      promptId: "prompt-test-100",
      permissionMode: "auto",
      effortLevel: "high",
      backgroundTasks: [],
      sessionCrons: [],
    });
  });

  it("Stop broadcasts the background work that keeps a session paused", async () => {
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "Stop",
        session_id: "session-test-100",
        transcript_path: "/tmp/test/session-test-100.jsonl",
        cwd: "/tmp/test/project",
        prompt_id: "prompt-test-100",
        permission_mode: "auto",
        effort: { level: "high" },
        background_tasks: [
          {
            id: "task-test-100",
            type: "agent",
            status: "running",
            description: "Inspect the example project",
            agent_type: "Explore",
          },
        ],
        session_crons: [
          {
            id: "cron-test-100",
            schedule: "0 * * * *",
            recurring: true,
            prompt: "Check the example service",
          },
        ],
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    const context = broadcasts.find(
      (broadcast) => broadcast.type === DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED,
    );
    if (!context) throw new Error("Expected session:hook-context-changed broadcast");
    expect(context.data).toStrictEqual({
      sessionId: "session-test-100",
      backgroundTasks: [
        {
          id: "task-test-100",
          type: "agent",
          status: "running",
          description: "Inspect the example project",
          agentType: "Explore",
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
      promptId: "prompt-test-100",
      permissionMode: "auto",
      effortLevel: "high",
    });
  });

  it("SessionStart also emits session:added when the session is indexed in the db", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "abc-123",
          fullPath: join(projectDir, "abc-123.jsonl"),
          fileMtime: 946_598_400_000,
          firstPrompt: "Fix the login bug",
          messageCount: 1,
          projectPath: "/Users/craig/projects/app",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "SessionStart",
        session_id: "abc-123",
        transcript_path: "/Users/craig/.claude/projects/-Users-craig-projects-app/abc-123.jsonl",
        cwd: "/Users/craig/projects/app",
        source: "startup",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    const added = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_ADDED);
    if (!added) throw new Error("Expected session:added broadcast");
    expect(added.data).toStrictEqual({
      session: {
        id: "abc-123",
        title: "Fix the login bug",
        summary: undefined,
        mtime: "1999-12-31T00:00:00.000Z",
        created: "1999-12-31T00:00:00.000Z",
        project: "-Users-craig-projects-app",
        projectName: "app",
        // indexSessionsIndex no longer trusts the sessions-index messageCount;
        // no transcript was indexed, so the canonical count is 0.
        messageCount: 0,
        gitBranch: undefined,
        starred: false,
        state: "unknown",
        blockedSince: null,
      },
    });
  });

  it("Stop broadcasts domain SESSION_UPDATED with enriched payload", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "abc-123",
          fullPath: join(projectDir, "abc-123.jsonl"),
          fileMtime: 946_598_400_000,
          firstPrompt: "Ship feature X",
          summary: "Shipped feature X",
          messageCount: 12,
          projectPath: "/Users/craig/projects/app",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "Stop",
        session_id: "abc-123",
        transcript_path: "/Users/craig/.claude/projects/-Users-craig-projects-app/abc-123.jsonl",
        cwd: "/Users/craig/projects/app",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["abc-123"]);
    const domain = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_UPDATED);
    if (!domain) throw new Error("Expected session:updated broadcast");
    expect(domain.data).toStrictEqual({
      session: {
        id: "abc-123",
        title: "Shipped feature X",
        summary: "Shipped feature X",
        mtime: "1999-12-31T00:00:00.000Z",
        created: "1999-12-31T00:00:00.000Z",
        project: "-Users-craig-projects-app",
        projectName: "app",
        // indexSessionsIndex no longer trusts the sessions-index messageCount;
        // no transcript was indexed, so the canonical count is 0.
        messageCount: 0,
        gitBranch: undefined,
        starred: false,
        state: "ended",
        blockedSince: null,
      },
    });
    expect(
      broadcasts.find((broadcast) => broadcast.type === DOMAIN_EVENTS.REVIEW_OFFERED),
    ).toStrictEqual({
      type: DOMAIN_EVENTS.REVIEW_OFFERED,
      data: { sessionId: "abc-123" },
    });
  });

  it("Stop from a spawned review fork does not recursively offer another review", async () => {
    const projectDir = join(testDir, "-Users-alice-projects-example");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "session-test-100",
          fullPath: join(projectDir, "session-test-100.jsonl"),
          fileMtime: 946_598_400_000,
          firstPrompt: "Review example",
          messageCount: 1,
          projectPath: "/Users/alice/projects/example",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-alice-projects-example");
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();

    await dispatchHookEvent({
      event: {
        hook_event_name: "Stop",
        session_id: "session-test-100",
        transcript_path: join(projectDir, "session-test-100.jsonl"),
        cwd: "/Users/alice/projects/example",
        claude_env: { CLAUDE_CCP_REVIEW_RUN: "1" },
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(broadcasts.map((broadcast) => broadcast.type)).toStrictEqual([
      DOMAIN_EVENTS.SESSION_UPDATED,
    ]);
  });

  it("Stop without an indexed session emits nothing on the wire", async () => {
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "Stop",
        session_id: "unknown-session",
        transcript_path: "/tmp/unknown.jsonl",
        cwd: "/tmp",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(broadcasts).toStrictEqual([]);
  });

  it("does not await detached herdr reporting before completing dispatch", async () => {
    const { store } = makeStore();
    const reportCalls: Array<{ event: HookEvent; entry: ActiveSessionEntry | null }> = [];
    const pendingReport = new Promise<void>(() => {});

    await dispatchHookEvent({
      event: {
        hook_event_name: "Stop",
        session_id: "session-test-100",
        transcript_path: "/tmp/test/session-test-100.jsonl",
        cwd: "/tmp/test/project",
      },
      db: db.index,
      store,
      broadcast: () => {},
      reportHerdrState: async (event, activeEntry) => {
        reportCalls.push({ event, entry: activeEntry });
        await pendingReport;
      },
    });

    expect(reportCalls).toStrictEqual([
      {
        event: {
          hook_event_name: "Stop",
          session_id: "session-test-100",
          transcript_path: "/tmp/test/session-test-100.jsonl",
          cwd: "/tmp/test/project",
        },
        entry: null,
      },
    ]);
  });

  it("SessionEnd broadcasts both lifecycle SESSION_END and domain SESSION_ENDED", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, endedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "SessionEnd",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(endedCalls).toStrictEqual(["abc-123"]);
    expect(broadcasts.find((b) => b.type === SSE_EVENTS.SESSION_END)!.data).toStrictEqual({
      sessionId: "abc-123",
    });
    expect(broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_ENDED)!.data).toStrictEqual({
      sessionId: "abc-123",
    });
  });

  it.each(["Stop", "SessionEnd"] as const)(
    "%s excludes the session's pending approval",
    async (hookEventName) => {
      const projectId = "-Users-craig-projects-app";
      const sessionId = `session-${hookEventName}`;
      const transcriptPath = join(testDir, `${sessionId}.jsonl`);
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: "assistant",
          sessionId,
          timestamp: "2026-08-06T12:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: `tool-${hookEventName}`,
                name: "ExitPlanMode",
                input: { plan: "## Plan" },
              },
            ],
          },
        })}\n`,
      );
      db.index
        .insert(schema.projects)
        .values({
          id: projectId,
          name: "app",
          projectPath: "/Users/craig/projects/app",
          updatedAt: 1,
        })
        .run();
      db.index
        .insert(schema.sessions)
        .values({
          id: sessionId,
          projectId,
          title: sessionId,
          firstPrompt: null,
          summary: null,
          customTitle: null,
          messageCount: 0,
          gitBranch: null,
          cwd: null,
          isSidechain: 0,
          createdAt: 1,
          mtimeMs: 1,
          filePath: transcriptPath,
        })
        .run();
      await initPendingApprovalsCache(db.index);
      expect(getPendingApprovals().map((approval) => approval.sessionId)).toStrictEqual([
        sessionId,
      ]);

      const { store } = makeStore();
      await dispatchHookEvent({
        event: {
          hook_event_name: hookEventName,
          session_id: sessionId,
          transcript_path: transcriptPath,
          cwd: "/Users/craig/projects/app",
        },
        db: db.index,
        store,
        broadcast: () => {},
      });

      expect(getPendingApprovals()).toStrictEqual([]);
    },
  );

  it("sets session state exactly once for every state-bearing event", async () => {
    const { store, stateCalls } = makeStore();
    const baseEvent = {
      session_id: "session-test-100",
      transcript_path: "/tmp/test/session-test-100.jsonl",
      cwd: "/tmp/test/project",
    } as const;
    const events: HookEvent[] = [
      { ...baseEvent, hook_event_name: "UserPromptSubmit", prompt: "Test prompt" },
      {
        ...baseEvent,
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: { question: "Test question?" },
      },
      {
        ...baseEvent,
        hook_event_name: "PreToolUse",
        tool_name: "ExitPlanMode",
        tool_input: { plan: "Test plan" },
      },
      {
        ...baseEvent,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "true" },
      },
      {
        ...baseEvent,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "true" },
      },
      {
        ...baseEvent,
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command: "false" },
        error: "Test failure",
      },
      { ...baseEvent, hook_event_name: "MessageDisplay", message: "Test response" },
      { ...baseEvent, hook_event_name: "PreCompact", trigger: "manual" },
      { ...baseEvent, hook_event_name: "PostCompact", reason: "manual" },
      { ...baseEvent, hook_event_name: "Stop" },
      { ...baseEvent, hook_event_name: "SessionEnd" },
    ];

    for (const event of events) {
      await dispatchHookEvent({
        event,
        db: db.index,
        store,
        broadcast: () => {},
        reportHerdrState: () => {},
      });
    }

    expect(stateCalls).toStrictEqual([
      { sessionId: "session-test-100", state: "working" },
      { sessionId: "session-test-100", state: "waiting" },
      { sessionId: "session-test-100", state: "waiting" },
      { sessionId: "session-test-100", state: "working" },
      { sessionId: "session-test-100", state: "working" },
      { sessionId: "session-test-100", state: "working" },
      { sessionId: "session-test-100", state: "working" },
      { sessionId: "session-test-100", state: "working" },
      { sessionId: "session-test-100", state: "idle" },
      { sessionId: "session-test-100", state: "idle" },
      { sessionId: "session-test-100", state: "idle" },
    ]);
  });

  it("never sets session state for events carrying no state information", async () => {
    clearAllNotifications();
    const { store, stateCalls } = makeStore();
    const baseEvent = {
      session_id: "session-test-100",
      transcript_path: "/tmp/test/session-test-100.jsonl",
      cwd: "/tmp/test/project",
    } as const;
    const events: HookEvent[] = [
      { ...baseEvent, hook_event_name: "SessionStart", source: "startup" },
      { ...baseEvent, hook_event_name: "SubagentStart" },
      { ...baseEvent, hook_event_name: "SubagentStop" },
      { ...baseEvent, hook_event_name: "Notification", message: "Test notification" },
      { ...baseEvent, hook_event_name: "PreCompact", trigger: "auto" },
      { ...baseEvent, hook_event_name: "PreCompact" },
      { ...baseEvent, hook_event_name: "PostCompact", reason: "auto" },
      { ...baseEvent, hook_event_name: "PostCompact" },
      { ...baseEvent, hook_event_name: "TaskCreated" },
      { ...baseEvent, hook_event_name: "TaskCompleted" },
      { ...baseEvent, hook_event_name: "WorktreeCreate" },
      { ...baseEvent, hook_event_name: "WorktreeRemove" },
      {
        ...baseEvent,
        hook_event_name: "CwdChanged",
        old_cwd: "/tmp/test/old-project",
        new_cwd: "/tmp/test/new-project",
      },
      {
        ...baseEvent,
        hook_event_name: "InstructionsLoaded",
        file_path: "/tmp/test/project/CLAUDE.md",
      },
      { ...baseEvent, hook_event_name: "ConfigChange", config_source: "project_settings" },
    ];

    for (const event of events) {
      await dispatchHookEvent({
        event,
        db: db.index,
        store,
        broadcast: () => {},
        reportHerdrState: () => {},
      });
    }

    expect(stateCalls).toStrictEqual([]);
  });

  it("retains the session pane mapping for detached SessionEnd cleanup", async () => {
    const activeEntry: ActiveSessionEntry = {
      sessionId: "session-test-100",
      state: "working",
      cwd: "/tmp/test/project",
      model: "claude-test-model",
      startedAt: 0,
      lastActivity: 0,
      claudeEnv: { HERDR_PANE_ID: "w100:p100" },
      tmuxPane: "",
      tmuxServerSocket: "",
      herdrPane: "w100:p100",
      herdrWorkspace: "w100",
      herdrSocketPath: "/tmp/test/herdr.sock",
    };
    let currentEntry: ActiveSessionEntry | null = activeEntry;
    const reportCalls: Array<{ event: HookEvent; entry: ActiveSessionEntry | null }> = [];

    await dispatchHookEvent({
      event: {
        hook_event_name: "SessionEnd",
        session_id: "session-test-100",
        transcript_path: "/tmp/test/session-test-100.jsonl",
        cwd: "/tmp/test/project",
      },
      db: db.index,
      store: {
        markSessionActive: () => {},
        markSessionEnded: () => {
          currentEntry = null;
        },
        setSessionState: (_sessionId, state) => {
          activeEntry.state = state;
        },
        touchSession: () => {},
        getActiveSessionEntry: () => currentEntry,
      },
      broadcast: () => {},
      reportHerdrState: (event, entryValue) => {
        reportCalls.push({ event, entry: entryValue });
      },
    });

    expect({ currentEntry, reportCalls }).toStrictEqual({
      currentEntry: null,
      reportCalls: [
        {
          event: {
            hook_event_name: "SessionEnd",
            session_id: "session-test-100",
            transcript_path: "/tmp/test/session-test-100.jsonl",
            cwd: "/tmp/test/project",
          },
          entry: activeEntry,
        },
      ],
    });
  });

  it("UserPromptSubmit broadcasts SESSION_PROMPT_SUBMITTED with the prompt body", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "UserPromptSubmit",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        prompt: "fix the login bug",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["abc-123"]);
    const submitted = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_PROMPT_SUBMITTED);
    if (!submitted) throw new Error("Expected session:prompt-submitted broadcast");
    expect(submitted.data["sessionId"]).toBe("abc-123");
    expect(submitted.data["prompt"]).toBe("fix the login bug");
    expect(typeof submitted.data["ts"]).toBe("string");
    const context = broadcasts.find(
      (broadcast) => broadcast.type === DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED,
    );
    if (!context) throw new Error("Expected session:hook-context-changed broadcast");
    expect(context.data).toStrictEqual({
      sessionId: "abc-123",
      promptId: "",
      permissionMode: "",
      effortLevel: "",
      backgroundTasks: [],
      sessionCrons: [],
    });
  });

  it("UserPromptSubmit re-stamps the tmux pane by passing claude_env to touchSession", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, touchCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "UserPromptSubmit",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        prompt: "resume work",
        claude_env: { TMUX_PANE: "%42", TMUX: "/tmp/tmux-501/default,900,0" },
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchCalls).toStrictEqual([
      {
        sessionId: "abc-123",
        meta: { claudeEnv: { TMUX_PANE: "%42", TMUX: "/tmp/tmux-501/default,900,0" } },
      },
    ]);
  });

  it("Notification broadcasts NOTIFICATION with message and optional title", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, stateCalls, touchCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "Notification",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        message: "Waiting for input",
        title: "Claude Code",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect({ stateCalls, touchCalls }).toStrictEqual({
      stateCalls: [],
      touchCalls: [{ sessionId: "abc-123" }],
    });
    const notif = broadcasts.find((b) => b.type === DOMAIN_EVENTS.NOTIFICATION);
    if (!notif) throw new Error("Expected notification broadcast");
    expect(notif.data).toStrictEqual({
      sessionId: "abc-123",
      message: "Waiting for input",
      title: "Claude Code",
    });
  });

  it("Notification persists into the notifications store with the classified type", async () => {
    clearAllNotifications();
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "Notification",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp/my-project",
        message: "Agent needs your input",
        title: "Claude Code",
        notification_type: "agent_needs_input",
      },
      db: db.index,
      store,
      broadcast: () => {},
    });

    const stored = getNotifications();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      sessionId: "abc-123",
      message: "Agent needs your input",
      title: "Claude Code",
      notificationType: "agent_needs_input",
      // Session is not indexed, so project resolution falls back to basename(cwd).
      projectId: "my-project",
      projectName: "my-project",
    });
  });

  it("Notification without notification_type persists with an empty-string type", async () => {
    clearAllNotifications();
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "Notification",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp/my-project",
        message: "Waiting for input",
      },
      db: db.index,
      store,
      broadcast: () => {},
    });

    const stored = getNotifications();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.notificationType).toBe("");
    // No title on the hook → absent, not `undefined`, per exactOptionalPropertyTypes.
    expect(stored[0] && "title" in stored[0]).toBe(false);
  });

  it("PreCompact broadcasts SESSION_COMPACTING with optional trigger", async () => {
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "PreCompact",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        trigger: "auto",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    const compacting = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_COMPACTING);
    if (!compacting) throw new Error("Expected session:compacting broadcast");
    expect(compacting.data).toStrictEqual({
      sessionId: "abc-123",
      trigger: "auto",
    });
  });

  it("PostCompact broadcasts SESSION_COMPACTED with reason and tokensRemoved", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "PostCompact",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        reason: "auto",
        tokens_removed: 5000,
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["abc-123"]);
    const compacted = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_COMPACTED);
    if (!compacted) throw new Error("Expected session:compacted broadcast");
    expect(compacted.data).toStrictEqual({
      sessionId: "abc-123",
      reason: "auto",
      tokensRemoved: 5000,
    });
  });

  it("PostCompact broadcasts SESSION_COMPACTED with undefined fields when optional fields absent", async () => {
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "PostCompact",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    const compacted = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_COMPACTED);
    if (!compacted) throw new Error("Expected session:compacted broadcast");
    expect(compacted.data).toStrictEqual({
      sessionId: "abc-123",
      reason: undefined,
      tokensRemoved: undefined,
    });
  });

  it("SubagentStop broadcasts SESSION_UPDATED for the subagent session id when indexed", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "sub-456",
          fullPath: join(projectDir, "sub-456.jsonl"),
          fileMtime: 946_598_400_000,
          firstPrompt: "subagent work",
          messageCount: 3,
          projectPath: "/Users/craig/projects/app",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");
    db.index
      .insert(schema.subagents)
      .values({
        id: "sub-456",
        sessionId: "parent-789",
        projectId: "project-test",
        parentAgentId: null,
        agentType: "Explore",
        filePath: "/tmp/test/sub-456.jsonl",
        mtimeMs: 1_000,
      })
      .run();

    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "SubagentStop",
        session_id: "sub-456",
        transcript_path: "/Users/craig/.claude/projects/-Users-craig-projects-app/sub-456.jsonl",
        cwd: "/tmp",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["sub-456"]);
    const stopped = broadcasts.find(
      (broadcast) => broadcast.type === DOMAIN_EVENTS.SUBAGENT_STOPPED,
    );
    if (!stopped) throw new Error("Expected subagent:stopped broadcast");
    expect(stopped.data).toStrictEqual({
      sessionId: "parent-789",
      agentType: "Explore",
      agentId: "sub-456",
    });
    const updated = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_UPDATED);
    if (!updated) throw new Error("Expected session:updated broadcast for subagent");
    expect((updated.data as { session: { id: string } }).session.id).toBe("sub-456");
  });

  it("SubagentStart broadcasts SUBAGENT_STARTED with agent_type / agent_id and touches the parent session", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(1999, 11, 31));
    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "SubagentStart",
        session_id: "parent-789",
        transcript_path: "/Users/u/.claude/projects/-h-u-p/parent-789.jsonl",
        cwd: "/tmp",
        agent_type: "general-purpose",
        agent_id: "sub-456",
        agent_config: {
          description: "Inspect test behavior",
        },
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["parent-789"]);
    const started = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SUBAGENT_STARTED);
    if (!started) throw new Error("Expected subagent:started broadcast");
    expect(started.data).toStrictEqual({
      sessionId: "parent-789",
      parentAgentId: null,
      agentType: "general-purpose",
      agentId: "agent-sub-456",
      description: "Inspect test behavior",
      startedAt: "1999-12-31T00:00:00.000Z",
      endedAt: null,
    });
  });

  it("SubagentStart without an agent id does not create an unkeyed live node", async () => {
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "SubagentStart",
        session_id: "parent-789",
        transcript_path: "/Users/u/.claude/projects/-h-u-p/parent-789.jsonl",
        cwd: "/tmp",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(broadcasts.filter((b) => b.type === DOMAIN_EVENTS.SUBAGENT_STARTED)).toStrictEqual([]);
  });

  it("Stop reconciles a killed live subagent and broadcasts its ended timestamp", async () => {
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(Date.UTC(1999, 11, 31))
      .mockReturnValueOnce(Date.UTC(1999, 11, 31, 0, 0, 5));

    await dispatchHookEvent({
      event: {
        hook_event_name: "SubagentStart",
        session_id: "parent-789",
        transcript_path: "/Users/u/.claude/projects/-h-u-p/parent-789.jsonl",
        cwd: "/tmp",
        agent_type: "Explore",
        agent_id: "alice",
        agent_config: { description: "Inspect test behavior" },
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });
    broadcasts.length = 0;

    await dispatchHookEvent({
      event: {
        hook_event_name: "Stop",
        session_id: "parent-789",
        transcript_path: "/Users/u/.claude/projects/-h-u-p/parent-789.jsonl",
        cwd: "/tmp",
        stop_hook_active: false,
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(broadcasts).toStrictEqual([
      {
        type: DOMAIN_EVENTS.SUBAGENT_STOPPED,
        data: {
          sessionId: "parent-789",
          agentType: "Explore",
          agentId: "agent-alice",
          endedAt: "1999-12-31T00:00:05.000Z",
        },
      },
    ]);
  });

  it("CwdChanged updates the active-session store cwd and broadcasts SESSION_CWD_CHANGED", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, activeCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "CwdChanged",
        session_id: "abc-123",
        transcript_path: "/Users/u/.claude/projects/-h-u-p/abc-123.jsonl",
        cwd: "/Users/u/projects/app",
        old_cwd: "/Users/u/projects/app",
        new_cwd: "/Users/u/projects/other-app",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(activeCalls).toStrictEqual([
      {
        sessionId: "abc-123",
        meta: { cwd: "/Users/u/projects/other-app" },
      },
    ]);
    const changed = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_CWD_CHANGED);
    if (!changed) throw new Error("Expected session:cwd-changed broadcast");
    expect(changed.data).toStrictEqual({
      sessionId: "abc-123",
      oldCwd: "/Users/u/projects/app",
      newCwd: "/Users/u/projects/other-app",
    });
  });

  it("InstructionsLoaded broadcasts INSTRUCTIONS_LOADED with the full payload and touches the session", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "InstructionsLoaded",
        session_id: "abc-123",
        transcript_path: "/Users/u/.claude/projects/-h-u-p/abc-123.jsonl",
        cwd: "/Users/u/projects/app",
        file_path: "/Users/u/projects/app/CLAUDE.md",
        memory_type: "project",
        load_reason: "session_start",
        globs: ["**/*.ts"],
        trigger_file_path: "/Users/u/projects/app/CLAUDE.md",
        parent_file_path: "/Users/u/projects/app/CLAUDE.md",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["abc-123"]);
    const loaded = broadcasts.find((b) => b.type === DOMAIN_EVENTS.INSTRUCTIONS_LOADED);
    if (!loaded) throw new Error("Expected instructions:loaded broadcast");
    expect(loaded.data).toStrictEqual({
      sessionId: "abc-123",
      filePath: "/Users/u/projects/app/CLAUDE.md",
      memoryType: "project",
      loadReason: "session_start",
      globs: ["**/*.ts"],
      triggerFilePath: "/Users/u/projects/app/CLAUDE.md",
      parentFilePath: "/Users/u/projects/app/CLAUDE.md",
    });
  });

  it("InstructionsLoaded with only required file_path emits undefined optional fields", async () => {
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "InstructionsLoaded",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        file_path: "/Users/u/.claude/CLAUDE.md",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    const loaded = broadcasts.find((b) => b.type === DOMAIN_EVENTS.INSTRUCTIONS_LOADED);
    if (!loaded) throw new Error("Expected instructions:loaded broadcast");
    expect(loaded.data).toStrictEqual({
      sessionId: "abc-123",
      filePath: "/Users/u/.claude/CLAUDE.md",
      memoryType: undefined,
      loadReason: undefined,
      globs: undefined,
      triggerFilePath: undefined,
      parentFilePath: undefined,
    });
  });

  it("ConfigChange broadcasts CONFIG_CHANGED with sessionId, configSource, and changedFields", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "ConfigChange",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        config_source: "user_settings",
        changed_fields: ["hooks.PostToolUse", "permissions.allow"],
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["abc-123"]);
    const changed = broadcasts.find((b) => b.type === DOMAIN_EVENTS.CONFIG_CHANGED);
    if (!changed) throw new Error("Expected config:changed broadcast");
    expect(changed.data).toStrictEqual({
      sessionId: "abc-123",
      configSource: "user_settings",
      changedFields: ["hooks.PostToolUse", "permissions.allow"],
    });
    expect(broadcasts.find((b) => b.type === SSE_EVENTS.CONTENT_UPDATED)).toBeUndefined();
  });

  it("ConfigChange with config_source=skills additionally broadcasts CONTENT_UPDATED for the plugins view", async () => {
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "ConfigChange",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        config_source: "skills",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    const changed = broadcasts.find((b) => b.type === DOMAIN_EVENTS.CONFIG_CHANGED);
    if (!changed) throw new Error("Expected config:changed broadcast");
    expect(changed.data).toStrictEqual({
      sessionId: "abc-123",
      configSource: "skills",
      changedFields: [],
    });
    const content = broadcasts.find((b) => b.type === SSE_EVENTS.CONTENT_UPDATED);
    if (!content) throw new Error("Expected content:updated broadcast for skills source");
    expect(content.data).toStrictEqual({});
  });

  it("MessageDisplay broadcasts MESSAGE_DISPLAYED with sessionId, message, and messageId", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "MessageDisplay",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        message: "Here is the answer you asked for.",
        message_id: "msg_018a7f9b2c3d4e5f",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["abc-123"]);
    const displayed = broadcasts.find((b) => b.type === DOMAIN_EVENTS.MESSAGE_DISPLAYED);
    if (!displayed) throw new Error("Expected message:displayed broadcast");
    expect(displayed.data).toStrictEqual({
      sessionId: "abc-123",
      message: "Here is the answer you asked for.",
      messageId: "msg_018a7f9b2c3d4e5f",
    });
  });

  it("MessageDisplay accepts payloads missing the optional message and messageId fields", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "MessageDisplay",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["abc-123"]);
    const displayed = broadcasts.find((b) => b.type === DOMAIN_EVENTS.MESSAGE_DISPLAYED);
    if (!displayed) throw new Error("Expected message:displayed broadcast");
    expect(displayed.data).toStrictEqual({
      sessionId: "abc-123",
      message: undefined,
      messageId: undefined,
    });
  });

  it("TaskCreated broadcasts the domain TASK_CREATED event", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "TaskCreated",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        task_id: "task-002",
        task_subject: "Ship feature",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["abc-123"]);
    const created = broadcasts.filter((b) => b.type === DOMAIN_EVENTS.TASK_CREATED);
    expect(created.length).toBe(1);
    expect(created[0]!.data).toStrictEqual({
      taskId: "task-002",
      subject: "Ship feature",
    });
  });

  it("TaskCompleted broadcasts the domain TASK_COMPLETED event", async () => {
    const broadcasts: Broadcast[] = [];
    const { store, touchedCalls } = makeStore();
    await dispatchHookEvent({
      event: {
        hook_event_name: "TaskCompleted",
        session_id: "abc-123",
        transcript_path: "/tmp/abc-123.jsonl",
        cwd: "/tmp",
        task_id: "task-001",
        task_subject: "Build auth",
      },
      db: db.index,
      store,
      broadcast: (type, data) => broadcasts.push({ type, data }),
    });

    expect(touchedCalls).toStrictEqual(["abc-123"]);
    const completed = broadcasts.filter((b) => b.type === DOMAIN_EVENTS.TASK_COMPLETED);
    expect(completed.length).toBe(1);
    expect(completed[0]!.data).toStrictEqual({
      taskId: "task-001",
      subject: "Build auth",
    });
  });

  describe("PostToolUse fast path", () => {
    function makeDirs(): import("../src/lib/hook-dispatcher").HookDispatchDirs {
      return {
        projectsDir: join(testDir, "projects"),
        plansDir: join(testDir, "plans"),
        tasksDir: join(testDir, "tasks"),
        commandsDir: join(testDir, "commands"),
        pluginsDir: join(testDir, "plugins", "cache"),
        statuslineDir: join(testDir, "statusline"),
      };
    }

    it("Edit on a plan markdown file indexes the file and broadcasts plan:changed", async () => {
      const dirs = makeDirs();
      mkdirSync(dirs.plansDir, { recursive: true });
      const planFilename = "2026-05-20-test-plan.md";
      const planPath = join(dirs.plansDir, planFilename);
      writeFileSync(planPath, "# Test Plan Title\n\nBody.\n");

      const broadcasts: Broadcast[] = [];
      const { store } = makeStore();

      await dispatchHookEvent({
        event: {
          hook_event_name: "PostToolUse",
          session_id: "abc-123",
          transcript_path: "/tmp/missing.jsonl",
          cwd: "/tmp",
          tool_name: "Edit",
          tool_input: {
            file_path: planPath,
            old_string: "Body.",
            new_string: "New body.",
          },
        },
        db: db.index,
        store,
        broadcast: (type, data) => broadcasts.push({ type, data }),
        dirs,
      });

      const planChanged = broadcasts.find((b) => b.type === DOMAIN_EVENTS.PLAN_CHANGED);
      if (!planChanged) throw new Error("Expected plan:changed broadcast");
      const plan = (
        planChanged.data as {
          plan: { filename: string; title: string; mtime: string };
        }
      ).plan;
      expect(plan.filename).toBe(planFilename);
      expect(plan.title).toBe("Test Plan Title");
      expect(typeof plan.mtime).toBe("string");
    });

    it("Write on a task json file indexes the task and broadcasts task:changed", async () => {
      const dirs = makeDirs();
      const projectDir = "sample-project";
      const tasksProjectDir = join(dirs.tasksDir, projectDir);
      mkdirSync(tasksProjectDir, { recursive: true });
      const taskId = "task-007";
      const taskPath = join(tasksProjectDir, `${taskId}.json`);
      writeFileSync(
        taskPath,
        JSON.stringify({
          id: taskId,
          subject: "Ship the thing",
          description: "desc",
          status: "in_progress",
          blocks: [],
          blockedBy: [],
        }),
      );

      const broadcasts: Broadcast[] = [];
      const { store, touchedCalls } = makeStore();

      await dispatchHookEvent({
        event: {
          hook_event_name: "PostToolUse",
          session_id: "abc-123",
          transcript_path: "/tmp/missing.jsonl",
          cwd: "/tmp",
          tool_name: "Write",
          tool_input: { file_path: taskPath, content: "{}" },
        },
        db: db.index,
        store,
        broadcast: (type, data) => broadcasts.push({ type, data }),
        dirs,
      });

      expect(touchedCalls).toStrictEqual(["abc-123"]);
      const taskChanged = broadcasts.find((b) => b.type === DOMAIN_EVENTS.TASK_CHANGED);
      if (!taskChanged) throw new Error("Expected task:changed broadcast");
      expect(taskChanged.data).toStrictEqual({
        task: {
          taskId,
          projectDir,
          subject: "Ship the thing",
          description: "desc",
          status: "in_progress",
          activeForm: null,
          owner: null,
          blocks: [],
          blockedBy: [],
        },
      });
    });

    it("Edit on an unrelated path emits no domain delta but still touches session", async () => {
      const dirs = makeDirs();
      const broadcasts: Broadcast[] = [];
      const { store, touchedCalls } = makeStore();

      await dispatchHookEvent({
        event: {
          hook_event_name: "PostToolUse",
          session_id: "abc-123",
          transcript_path: "/tmp/missing.jsonl",
          cwd: "/tmp",
          tool_name: "Edit",
          tool_input: {
            file_path: join(testDir, "unrelated", "note.md"),
            old_string: "a",
            new_string: "b",
          },
        },
        db: db.index,
        store,
        broadcast: (type, data) => broadcasts.push({ type, data }),
        dirs,
      });

      expect(touchedCalls).toStrictEqual(["abc-123"]);
      const domain = broadcasts.find(
        (b) =>
          b.type === DOMAIN_EVENTS.PLAN_CHANGED ||
          b.type === DOMAIN_EVENTS.TASK_CHANGED ||
          b.type === DOMAIN_EVENTS.MEMORY_CHANGED,
      );
      expect(domain).toBeUndefined();
    });

    it("PreToolUse broadcasts SESSION_TOOL_PENDING with toolName and toolUseId", async () => {
      const broadcasts: Broadcast[] = [];
      const { store, touchedCalls } = makeStore();
      await dispatchHookEvent({
        event: {
          hook_event_name: "PreToolUse",
          session_id: "abc-123",
          transcript_path: "/tmp/abc-123.jsonl",
          cwd: "/tmp",
          tool_name: "Bash",
          tool_use_id: "toolu_abc",
          tool_input: { command: "ls" },
        },
        db: db.index,
        store,
        broadcast: (type, data) => broadcasts.push({ type, data }),
      });

      expect(touchedCalls).toStrictEqual(["abc-123"]);
      const pending = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_TOOL_PENDING);
      if (!pending) throw new Error("Expected session:tool-pending broadcast");
      expect(pending.data).toStrictEqual({
        sessionId: "abc-123",
        toolName: "Bash",
        toolUseId: "toolu_abc",
      });
    });

    it("PostToolUseFailure broadcasts SESSION_TOOL_FAILED with toolName, toolUseId, error", async () => {
      const broadcasts: Broadcast[] = [];
      const { store, touchedCalls } = makeStore();
      await dispatchHookEvent({
        event: {
          hook_event_name: "PostToolUseFailure",
          session_id: "abc-123",
          transcript_path: "/tmp/abc-123.jsonl",
          cwd: "/tmp",
          tool_name: "Bash",
          tool_use_id: "toolu_fail_01",
          tool_input: { command: "exit 1" },
          error: "Command exited with status 1",
        },
        db: db.index,
        store,
        broadcast: (type, data) => broadcasts.push({ type, data }),
      });

      expect(touchedCalls).toStrictEqual(["abc-123"]);
      const failed = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_TOOL_FAILED);
      if (!failed) throw new Error("Expected session:tool-failed broadcast");
      expect(failed.data).toStrictEqual({
        sessionId: "abc-123",
        toolName: "Bash",
        toolUseId: "toolu_fail_01",
        error: "Command exited with status 1",
      });
    });

    it("PostToolUse with a transcript_path broadcasts session:lines-appended for new lines only", async () => {
      const dirs = makeDirs();
      const projectId = "-Users-craig-projects-app";
      const projectDir = join(dirs.projectsDir, projectId);
      mkdirSync(projectDir, { recursive: true });
      const sessionId = "abc-123";
      const transcriptPath = join(projectDir, `${sessionId}.jsonl`);
      const line1 = JSON.stringify({ type: "user", message: "hello" });
      const line2 = JSON.stringify({ type: "assistant", message: "world" });
      writeFileSync(transcriptPath, line1 + "\n" + line2 + "\n");

      const broadcasts: Broadcast[] = [];
      const { store } = makeStore();
      const state: import("../src/lib/hook-dispatcher").HookDispatchState = {
        jsonlOffsets: new Map(),
      };

      await dispatchHookEvent({
        event: {
          hook_event_name: "PostToolUse",
          session_id: sessionId,
          transcript_path: transcriptPath,
          cwd: "/tmp",
          tool_name: "Bash",
          tool_input: { command: "echo hi" },
        },
        db: db.index,
        store,
        broadcast: (type, data) => broadcasts.push({ type, data }),
        dirs,
        state,
      });

      const linesAppended = broadcasts.filter(
        (b) => b.type === DOMAIN_EVENTS.SESSION_LINES_APPENDED,
      );
      expect(linesAppended.length).toBe(1);
      expect(linesAppended[0]!.data["sessionId"]).toBe(sessionId);
      expect((linesAppended[0]!.data["lines"] as unknown[]).length).toBe(2);

      // Second event with no new content -- no broadcast.
      broadcasts.length = 0;
      await dispatchHookEvent({
        event: {
          hook_event_name: "PostToolUse",
          session_id: sessionId,
          transcript_path: transcriptPath,
          cwd: "/tmp",
          tool_name: "Bash",
          tool_input: { command: "echo hi" },
        },
        db: db.index,
        store,
        broadcast: (type, data) => broadcasts.push({ type, data }),
        dirs,
        state,
      });

      expect(broadcasts.filter((b) => b.type === DOMAIN_EVENTS.SESSION_LINES_APPENDED).length).toBe(
        0,
      );
    });
  });

  describe("dedupe between hook fast-path and watcher trailing broadcast", () => {
    it("only broadcasts plan:changed once when PostToolUse fires then watcher trails", async () => {
      const { __testing: dedupeTesting } = await import("../src/lib/update-dedupe");
      dedupeTesting.clear();

      const dirs = {
        projectsDir: join(testDir, "projects"),
        plansDir: join(testDir, "plans"),
        tasksDir: join(testDir, "tasks"),
        commandsDir: join(testDir, "commands"),
        pluginsDir: join(testDir, "plugins", "cache"),
        statuslineDir: join(testDir, "statusline"),
      };
      mkdirSync(dirs.plansDir, { recursive: true });
      const planFilename = "2026-05-20-dedupe-plan.md";
      const planPath = join(dirs.plansDir, planFilename);
      writeFileSync(planPath, "# Dedupe Plan\n\nBody.\n");

      const broadcasts: Broadcast[] = [];
      const broadcast = (type: string, data: Record<string, unknown>): void => {
        broadcasts.push({ type, data });
      };
      const { store } = makeStore();

      // 1. Hook fast-path broadcasts plan:changed.
      await dispatchHookEvent({
        event: {
          hook_event_name: "PostToolUse",
          session_id: "abc-123",
          transcript_path: "/tmp/missing.jsonl",
          cwd: "/tmp",
          tool_name: "Edit",
          tool_input: {
            file_path: planPath,
            old_string: "Body.",
            new_string: "New.",
          },
        },
        db: db.index,
        store,
        broadcast,
        dirs,
      });

      // 2. Simulate the chokidar trailing broadcast for the same file.
      const { __testing: watcherTesting } = await import("../src/lib/watcher");
      await watcherTesting.handlePlanMdChange(
        db.index,
        planPath,
        dirs.projectsDir,
        dirs.plansDir,
        broadcast,
      );

      const planChanged = broadcasts.filter((b) => b.type === DOMAIN_EVENTS.PLAN_CHANGED);
      expect(planChanged.length).toBe(1);
    });

    it("only broadcasts task:changed once when PostToolUse fires then a second identical call trails", async () => {
      const { __testing: dedupeTesting } = await import("../src/lib/update-dedupe");
      dedupeTesting.clear();

      const dirs = {
        projectsDir: join(testDir, "projects"),
        plansDir: join(testDir, "plans"),
        tasksDir: join(testDir, "tasks"),
        commandsDir: join(testDir, "commands"),
        pluginsDir: join(testDir, "plugins", "cache"),
        statuslineDir: join(testDir, "statusline"),
      };
      const projectDir = "sample-project";
      const tasksProjectDir = join(dirs.tasksDir, projectDir);
      mkdirSync(tasksProjectDir, { recursive: true });
      const taskId = "task-dd-001";
      const taskPath = join(tasksProjectDir, `${taskId}.json`);
      writeFileSync(
        taskPath,
        JSON.stringify({
          id: taskId,
          subject: "Dedupe me",
          description: "desc",
          status: "in_progress",
          blocks: [],
          blockedBy: [],
        }),
      );

      const broadcasts: Broadcast[] = [];
      const broadcast = (type: string, data: Record<string, unknown>): void => {
        broadcasts.push({ type, data });
      };
      const { store } = makeStore();

      const event: HookEvent = {
        hook_event_name: "PostToolUse",
        session_id: "abc-123",
        transcript_path: "/tmp/missing.jsonl",
        cwd: "/tmp",
        tool_name: "Write",
        tool_input: { file_path: taskPath, content: "{}" },
      };

      await dispatchHookEvent({ event, db: db.index, store, broadcast, dirs });
      // Fire the same hook again -- simulates the watcher's trailing broadcast
      // for the same task file with the same status signal.
      await dispatchHookEvent({ event, db: db.index, store, broadcast, dirs });

      const taskChanged = broadcasts.filter((b) => b.type === DOMAIN_EVENTS.TASK_CHANGED);
      expect(taskChanged.length).toBe(1);
    });
  });
});
