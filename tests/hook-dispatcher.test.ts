import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { indexSessionsIndex } from "../src/lib/db/indexer";
import { dispatchHookEvent } from "../src/lib/hook-dispatcher";
import { DOMAIN_EVENTS, SSE_EVENTS } from "../src/lib/hook-events";
import type { HookEvent } from "../src/lib/hook-events";

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
  const touchedCalls: string[] = [];
  return {
    activeCalls,
    endedCalls,
    touchedCalls,
    store: {
      markSessionActive: (sessionId: string, meta: StoreMeta) => {
        activeCalls.push({ sessionId, meta });
      },
      markSessionEnded: (sessionId: string) => {
        endedCalls.push(sessionId);
      },
      touchSession: (sessionId: string) => {
        touchedCalls.push(sessionId);
      },
      getActiveSessionEntry: (sessionId: string) => {
        const call = activeCalls.find((c) => c.sessionId === sessionId);
        if (!call) return null;
        return {
          sessionId,
          cwd: call.meta.cwd,
          model: call.meta.model ?? "",
          startedAt: 946_598_400_000,
          lastActivity: 946_598_400_000,
          claudeEnv: call.meta.claudeEnv ?? {},
        };
      },
    },
  };
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
  db = openTestDb();
});

afterEach(() => {
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
        messageCount: 1,
        gitBranch: undefined,
        starred: false,
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
        messageCount: 12,
        gitBranch: undefined,
        starred: false,
      },
    });
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
  });

  it("Notification broadcasts NOTIFICATION with message and optional title", async () => {
    const broadcasts: Broadcast[] = [];
    const { store } = makeStore();
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

    const notif = broadcasts.find((b) => b.type === DOMAIN_EVENTS.NOTIFICATION);
    if (!notif) throw new Error("Expected notification broadcast");
    expect(notif.data).toStrictEqual({
      sessionId: "abc-123",
      message: "Waiting for input",
      title: "Claude Code",
    });
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
    const updated = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SESSION_UPDATED);
    if (!updated) throw new Error("Expected session:updated broadcast for subagent");
    expect((updated.data as { session: { id: string } }).session.id).toBe("sub-456");
  });

  it("SubagentStart broadcasts SUBAGENT_STARTED with agent_type / agent_id and touches the parent session", async () => {
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
      agentType: "general-purpose",
      agentId: "sub-456",
    });
  });

  it("SubagentStart defaults missing agent_type / agent_id to empty strings in the broadcast", async () => {
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

    const started = broadcasts.find((b) => b.type === DOMAIN_EVENTS.SUBAGENT_STARTED);
    if (!started) throw new Error("Expected subagent:started broadcast");
    expect(started.data).toStrictEqual({
      sessionId: "parent-789",
      agentType: "",
      agentId: "",
    });
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
