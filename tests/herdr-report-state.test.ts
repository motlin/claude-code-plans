import { describe, expect, it } from "vite-plus/test";
import type { ActiveSessionEntry } from "../src/lib/active-session-store";
import type { HookEvent } from "../src/lib/hook-events";
import type { HerdrResult } from "../src/lib/herdr/client";
import {
  createHerdrSequence,
  reportHookStateToHerdr,
  stateForHerdrHookEvent,
  type HerdrHookStateDependencies,
  type HerdrReportObservation,
} from "../src/lib/herdr/report-state";

const baseEvent = {
  session_id: "session-test-100",
  transcript_path: "/tmp/test/session-test-100.jsonl",
  cwd: "/tmp/test/project",
};

function entry(): ActiveSessionEntry {
  return {
    sessionId: "session-test-100",
    state: "working",
    cwd: "/tmp/test/project",
    model: "claude-test-model",
    startedAt: 0,
    lastActivity: 0,
    claudeEnv: {},
    tmuxPane: "",
    tmuxServerSocket: "",
    herdrPane: "w100:p100",
    herdrWorkspace: "w100",
    herdrSocketPath: "/tmp/test/herdr.sock",
  };
}

function paneInfo(overrides: Record<string, unknown> = {}): object {
  return {
    type: "pane_info",
    pane: {
      pane_id: "w100:p100",
      terminal_id: "terminal-test-100",
      workspace_id: "w100",
      tab_id: "w100:t100",
      focused: true,
      agent_status: "unknown",
      agent: null,
      agent_session: null,
      revision: 100,
      ...overrides,
    },
  };
}

function dependencies(
  request: HerdrHookStateDependencies["request"],
  observations: HerdrReportObservation[],
): HerdrHookStateDependencies {
  return {
    writesEnabled: () => true,
    resolveTarget: async () => ({
      ok: true,
      value: { terminalId: "terminal-test-100", paneId: "w100:p100" },
    }),
    request,
    nextSequence: () => ({ timestamp: 946_684_800_000, ordinal: 0, value: 946_684_800_000_000 }),
    observe: (observation) => observations.push(observation),
  };
}

async function settleDetachedReport(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("herdr hook-state reporting", () => {
  it("maps hook events to only herdr-supported states", () => {
    const events: HookEvent[] = [
      { ...baseEvent, hook_event_name: "UserPromptSubmit", prompt: "Test prompt" },
      {
        ...baseEvent,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "printf test" },
      },
      {
        ...baseEvent,
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: { questions: [] },
      },
      {
        ...baseEvent,
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command: "false" },
      },
      { ...baseEvent, hook_event_name: "PreCompact", trigger: "manual" },
      { ...baseEvent, hook_event_name: "PreCompact", trigger: "auto" },
      { ...baseEvent, hook_event_name: "PostCompact", reason: "manual" },
      { ...baseEvent, hook_event_name: "Stop" },
      {
        ...baseEvent,
        hook_event_name: "Notification",
        message: "Fabricated notification",
      },
    ];

    expect(events.map(stateForHerdrHookEvent)).toStrictEqual([
      { state: "working", message: "responding to prompt" },
      { state: "working", message: "using Bash" },
      { state: "blocked", message: "waiting for AskUserQuestion" },
      { state: "working", message: "Bash failed" },
      { state: "working", message: "compacting context" },
      null,
      { state: "idle", message: "manual compaction complete" },
      { state: "idle", message: "ready" },
      null,
    ]);
  });

  it("keeps source sequence numbers increasing within a millisecond and across clock rewind", () => {
    const timestamps = [946_684_800_000, 946_684_800_000, 946_684_799_000, 946_684_801_000];
    const nextSequence = createHerdrSequence(() => {
      const timestamp = timestamps.shift();
      if (timestamp === undefined) throw new Error("missing fabricated timestamp");
      return timestamp;
    });

    expect([nextSequence(), nextSequence(), nextSequence(), nextSequence()]).toStrictEqual([
      { timestamp: 946_684_800_000, ordinal: 0, value: 946_684_800_000_000 },
      { timestamp: 946_684_800_000, ordinal: 1, value: 946_684_800_000_001 },
      { timestamp: 946_684_799_000, ordinal: 1_000_002, value: 946_684_800_000_002 },
      { timestamp: 946_684_801_000, ordinal: 0, value: 946_684_801_000_000 },
    ]);
  });

  it("reports authoritative state with the ccp source and verifies it by pane.get", async () => {
    const requests: object[] = [];
    const observations: HerdrReportObservation[] = [];
    let paneReads = 0;
    const request = async (requestValue: object): Promise<HerdrResult<unknown>> => {
      requests.push(requestValue);
      const method = (requestValue as { method: string }).method;
      if (method === "pane.get") {
        paneReads += 1;
        return {
          ok: true,
          value: paneReads === 1 ? paneInfo() : paneInfo({ agent_status: "idle", agent: "claude" }),
        };
      }
      return { ok: true, value: { type: "ok" } };
    };

    reportHookStateToHerdr(
      { ...baseEvent, hook_event_name: "Stop" },
      entry(),
      dependencies(request, observations),
    );
    await settleDetachedReport();

    expect({ requests, observations }).toStrictEqual({
      requests: [
        { id: "ccp:hook-pane", method: "pane.get", params: { pane_id: "w100:p100" } },
        {
          id: "ccp:946684800000:0",
          method: "pane.report_agent",
          params: {
            pane_id: "w100:p100",
            source: "ccp",
            agent: "claude",
            state: "idle",
            message: "ready",
            seq: 946_684_800_000_000,
          },
        },
        {
          id: "ccp:946684800000:0:verify",
          method: "pane.get",
          params: { pane_id: "w100:p100" },
        },
      ],
      observations: [
        {
          outcome: "verified",
          method: "pane.report_agent",
          paneId: "w100:p100",
          message: "pane.get confirmed write",
        },
      ],
    });
  });

  it("falls back to display metadata when another source owns the agent session", async () => {
    const requests: object[] = [];
    const observations: HerdrReportObservation[] = [];
    let paneReads = 0;
    const owner = {
      source: "herdr:claude",
      agent: "claude",
      kind: "id",
      value: "session-test-200",
    };
    const labels = {
      idle: "idle (ccp)",
      working: "working (ccp)",
      blocked: "blocked (ccp)",
      unknown: "unknown (ccp)",
    };
    const request = async (requestValue: object): Promise<HerdrResult<unknown>> => {
      requests.push(requestValue);
      if ((requestValue as { method: string }).method === "pane.get") {
        paneReads += 1;
        return {
          ok: true,
          value:
            paneReads === 1
              ? paneInfo({ agent_session: owner })
              : paneInfo({
                  agent_session: owner,
                  title: "responding to prompt",
                  display_agent: "Claude (ccp)",
                  state_labels: labels,
                  tokens: { ccp_state: "working" },
                }),
        };
      }
      return { ok: true, value: { type: "ok" } };
    };

    reportHookStateToHerdr(
      { ...baseEvent, hook_event_name: "UserPromptSubmit", prompt: "Test prompt" },
      entry(),
      dependencies(request, observations),
    );
    await settleDetachedReport();

    expect({ requests, observations }).toStrictEqual({
      requests: [
        { id: "ccp:hook-pane", method: "pane.get", params: { pane_id: "w100:p100" } },
        {
          id: "ccp:946684800000:0",
          method: "pane.report_metadata",
          params: {
            pane_id: "w100:p100",
            source: "ccp",
            title: "responding to prompt",
            display_agent: "Claude (ccp)",
            state_labels: labels,
            tokens: { ccp_state: "working" },
            seq: 946_684_800_000_000,
          },
        },
        {
          id: "ccp:946684800000:0:verify",
          method: "pane.get",
          params: { pane_id: "w100:p100" },
        },
      ],
      observations: [
        {
          outcome: "metadata-fallback",
          method: "pane.report_metadata",
          paneId: "w100:p100",
          message: "agent session is owned by herdr:claude",
        },
        {
          outcome: "verified",
          method: "pane.report_metadata",
          paneId: "w100:p100",
          message: "pane.get confirmed write",
        },
      ],
    });
  });

  it("clears ccp authority on SessionEnd and verifies the pane afterward", async () => {
    const requests: object[] = [];
    const observations: HerdrReportObservation[] = [];
    const request = async (requestValue: object): Promise<HerdrResult<unknown>> => {
      requests.push(requestValue);
      if ((requestValue as { method: string }).method === "pane.get") {
        return { ok: true, value: paneInfo() };
      }
      return { ok: true, value: { type: "ok" } };
    };

    reportHookStateToHerdr(
      { ...baseEvent, hook_event_name: "SessionEnd", reason: "test complete" },
      entry(),
      dependencies(request, observations),
    );
    await settleDetachedReport();

    expect({ requests, observations }).toStrictEqual({
      requests: [
        { id: "ccp:hook-pane", method: "pane.get", params: { pane_id: "w100:p100" } },
        {
          id: "ccp:946684800000:0",
          method: "pane.clear_agent_authority",
          params: { pane_id: "w100:p100", source: "ccp", seq: 946_684_800_000_000 },
        },
        {
          id: "ccp:946684800000:0:verify",
          method: "pane.get",
          params: { pane_id: "w100:p100" },
        },
      ],
      observations: [
        {
          outcome: "verified",
          method: "pane.clear_agent_authority",
          paneId: "w100:p100",
          message: "pane.get confirmed write",
        },
      ],
    });
  });

  it("does not trust a successful report response when readback disagrees", async () => {
    const observations: HerdrReportObservation[] = [];
    let paneReads = 0;
    const request = async (requestValue: object): Promise<HerdrResult<unknown>> => {
      if ((requestValue as { method: string }).method === "pane.get") {
        paneReads += 1;
        return {
          ok: true,
          value: paneReads === 1 ? paneInfo() : paneInfo({ agent_status: "unknown", agent: null }),
        };
      }
      return { ok: true, value: { type: "ok" } };
    };

    reportHookStateToHerdr(
      { ...baseEvent, hook_event_name: "Stop" },
      entry(),
      dependencies(request, observations),
    );
    await settleDetachedReport();

    expect(observations).toStrictEqual([
      {
        outcome: "verification-error",
        method: "pane.report_agent",
        paneId: "w100:p100",
        message: "readback did not confirm claude/idle without an owner",
      },
    ]);
  });

  it("observes rejected socket work without creating an unhandled rejection", async () => {
    const observations: HerdrReportObservation[] = [];
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      reportHookStateToHerdr(
        { ...baseEvent, hook_event_name: "Stop" },
        entry(),
        dependencies(async () => {
          throw new Error("fabricated socket rejection");
        }, observations),
      );
      await settleDetachedReport();

      expect({ observations, unhandledRejections }).toStrictEqual({
        observations: [
          {
            outcome: "request-error",
            method: "pane.report_agent",
            paneId: "w100:p100",
            message: "fabricated socket rejection",
          },
        ],
        unhandledRejections: [],
      });
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
