import { describe, expect, it, vi } from "vite-plus/test";
import type { ActiveSessionEntry } from "../src/lib/active-session-store";
import type { HerdrResult } from "../src/lib/herdr/client";
import {
  handleHerdrPrompt,
  herdrWritesEnabled,
  resolveHerdrPromptTarget,
  type HerdrPromptDependencies,
} from "../src/lib/herdr/prompt";
import type { HerdrRequester } from "../src/lib/herdr/panes";
import { rejectCrossSite } from "../src/lib/same-origin-guard";

function request(body: unknown, headers?: HeadersInit): Request {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Content-Type", "application/json");
  return new Request("http://127.0.0.1:7526/api/herdr/prompt", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

async function describeResponse(response: Response): Promise<{
  body: unknown;
  status: number;
}> {
  const contentType = response.headers.get("content-type");
  return {
    body: contentType?.startsWith("application/json")
      ? await response.json()
      : await response.text(),
    status: response.status,
  };
}

function entry(overrides: Partial<ActiveSessionEntry> = {}): ActiveSessionEntry {
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
    ...overrides,
  };
}

function snapshot(paneId: string): object {
  const workspaceId = paneId.split(":")[0];
  return {
    type: "session_snapshot",
    snapshot: {
      version: "99.0.0-test",
      protocol: 100,
      workspaces: [],
      tabs: [],
      panes: [
        {
          pane_id: paneId,
          terminal_id: "terminal-test-100",
          workspace_id: workspaceId,
          tab_id: `${workspaceId}:t100`,
          focused: true,
          agent_status: "idle",
          agent: "claude",
          agent_session: {
            source: "test-source",
            agent: "claude",
            kind: "id",
            value: "session-test-100",
          },
          revision: 100,
        },
      ],
      layouts: [],
      agents: [],
      focused_workspace_id: workspaceId,
      focused_tab_id: `${workspaceId}:t100`,
      focused_pane_id: paneId,
    },
  };
}

function dependencies(overrides: Partial<HerdrPromptDependencies> = {}): HerdrPromptDependencies {
  return {
    rejectRequest: rejectCrossSite,
    writesEnabled: () => true,
    resolveTarget: async () => ({
      ok: true,
      value: { terminalId: "terminal-test-100", paneId: "w100:p100" },
    }),
    request: async () => ({ ok: true, value: { type: "agent_prompted" } }),
    createRequestId: () => "ccp:prompt:test-100",
    ...overrides,
  };
}

describe("herdr prompt write handler", () => {
  it("defaults the write feature flag to off", () => {
    expect([
      herdrWritesEnabled({}),
      herdrWritesEnabled({ CCP_ENABLE_HERDR_WRITES: "0" }),
      herdrWritesEnabled({ CCP_ENABLE_HERDR_WRITES: "true" }),
      herdrWritesEnabled({ CCP_ENABLE_HERDR_WRITES: "1" }),
    ]).toStrictEqual([false, false, false, true]);
  });

  it("returns before parsing or resolving when writes are disabled", async () => {
    const resolveTarget = vi.fn<HerdrPromptDependencies["resolveTarget"]>();
    const sendRequest = vi.fn<HerdrRequester>();

    const response = await handleHerdrPrompt(
      request({ sessionId: "session-test-100", prompt: "Test prompt" }),
      dependencies({ writesEnabled: () => false, resolveTarget, request: sendRequest }),
    );

    expect({
      response: await describeResponse(response),
      resolveTargetCalls: resolveTarget.mock.calls,
      sendRequestCalls: sendRequest.mock.calls,
    }).toStrictEqual({
      response: { body: { error: "herdr writes are disabled" }, status: 403 },
      resolveTargetCalls: [],
      sendRequestCalls: [],
    });
  });

  it("rejects cross-site requests before checking the feature flag", async () => {
    const calls: string[] = [];

    const response = await handleHerdrPrompt(
      request(
        { sessionId: "session-test-100", prompt: "Test prompt" },
        { Origin: "https://attacker.example.com", "Sec-Fetch-Site": "cross-site" },
      ),
      dependencies({
        rejectRequest: (candidate) => {
          calls.push("guard");
          return rejectCrossSite(candidate);
        },
        writesEnabled: () => {
          calls.push("feature");
          return true;
        },
      }),
    );

    expect({ response: await describeResponse(response), calls }).toStrictEqual({
      response: { body: { error: "Forbidden" }, status: 403 },
      calls: ["guard"],
    });
  });

  it("returns 400 without resolving for invalid input", async () => {
    const resolveTarget = vi.fn<HerdrPromptDependencies["resolveTarget"]>();

    const response = await handleHerdrPrompt(
      request({ sessionId: "session-test-100" }),
      dependencies({ resolveTarget }),
    );

    expect({
      response: await describeResponse(response),
      resolveTargetCalls: resolveTarget.mock.calls,
    }).toStrictEqual({
      response: { body: { error: "sessionId and prompt are required" }, status: 400 },
      resolveTargetCalls: [],
    });
  });

  it("re-resolves a durable terminal to its current pane for every request", async () => {
    const snapshots = [snapshot("w100:p100"), snapshot("w200:p200")];
    const requests: object[] = [];
    const requester: HerdrRequester = async (requestValue) => {
      requests.push(requestValue);
      const value = snapshots.shift();
      if (!value) throw new Error("missing fabricated snapshot");
      return { ok: true, value };
    };
    const entries = [entry()];

    const targets = await Promise.all([
      resolveHerdrPromptTarget("session-test-100", entries, requester),
      resolveHerdrPromptTarget("session-test-100", entries, requester),
    ]);

    expect({ targets, requests }).toStrictEqual({
      targets: [
        {
          ok: true,
          value: { terminalId: "terminal-test-100", paneId: "w100:p100" },
        },
        {
          ok: true,
          value: { terminalId: "terminal-test-100", paneId: "w200:p200" },
        },
      ],
      requests: [
        { id: "ccp:prompt-snap", method: "session.snapshot", params: {} },
        { id: "ccp:prompt-snap", method: "session.snapshot", params: {} },
      ],
    });
  });

  it("sends the exact agent.prompt request to the current pane", async () => {
    const requests: object[] = [];
    const sendRequest: HerdrRequester = async (requestValue) => {
      requests.push(requestValue);
      return { ok: true, value: { type: "agent_prompted" } };
    };

    const response = await handleHerdrPrompt(
      request({ sessionId: "session-test-100", prompt: "Test prompt for Alice\nSecond line" }),
      dependencies({ request: sendRequest }),
    );

    expect({ response: await describeResponse(response), requests }).toStrictEqual({
      response: { body: { ok: true }, status: 200 },
      requests: [
        {
          id: "ccp:prompt:test-100",
          method: "agent.prompt",
          params: {
            target: "w100:p100",
            text: "Test prompt for Alice\nSecond line",
          },
        },
      ],
    });
  });

  it.each([
    { code: "agent_not_ready", status: 409 },
    { code: "agent_prompt_stalled", status: 409 },
    { code: "empty_agent_prompt", status: 400 },
    { code: "fabricated_transport_error", status: 502 },
  ])("maps $code to HTTP $status with the herdr reason", async ({ code, status }) => {
    const error: HerdrResult<unknown> = {
      ok: false,
      code,
      message: `Fabricated ${code} reason`,
    };

    const response = await handleHerdrPrompt(
      request({ sessionId: "session-test-100", prompt: "Test prompt" }),
      dependencies({ request: async () => error }),
    );

    expect(await describeResponse(response)).toStrictEqual({
      body: { error: `Fabricated ${code} reason` },
      status,
    });
  });
});
