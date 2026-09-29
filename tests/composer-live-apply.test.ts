import { describe, expect, it, vi } from "vite-plus/test";
import { sendHerdrLiveOption } from "../src/lib/api/herdr";
import {
  handleHerdrLiveOption,
  type HerdrLiveOptionDependencies,
} from "../src/lib/herdr/live-option";
import type { HerdrRequester } from "../src/lib/herdr/panes";
import { canApplyLive, type LaunchPermissionMode, shiftTabCount } from "../src/lib/launch-options";
import { rejectCrossSite } from "../src/lib/same-origin-guard";

const WITHOUT_BYPASS: LaunchPermissionMode[] = ["auto", "default", "acceptEdits", "plan"];
const WITH_BYPASS: LaunchPermissionMode[] = [...WITHOUT_BYPASS, "bypassPermissions"];

describe("shiftTabCount", () => {
  it("counts presses forward through the CLI cycle default → acceptEdits → plan → auto → bypass", () => {
    expect({
      defaultToDefault: shiftTabCount("default", "default", WITH_BYPASS),
      defaultToAcceptEdits: shiftTabCount("default", "acceptEdits", WITH_BYPASS),
      defaultToPlan: shiftTabCount("default", "plan", WITH_BYPASS),
      defaultToAuto: shiftTabCount("default", "auto", WITH_BYPASS),
      defaultToBypass: shiftTabCount("default", "bypassPermissions", WITH_BYPASS),
      bypassToDefault: shiftTabCount("bypassPermissions", "default", WITH_BYPASS),
      planToAcceptEdits: shiftTabCount("plan", "acceptEdits", WITH_BYPASS),
    }).toStrictEqual({
      defaultToDefault: 0,
      defaultToAcceptEdits: 1,
      defaultToPlan: 2,
      defaultToAuto: 3,
      defaultToBypass: 4,
      bypassToDefault: 1,
      planToAcceptEdits: 4,
    });
  });

  it("skips unavailable modes and refuses targets or starting points outside the cycle", () => {
    expect({
      autoToDefault: shiftTabCount("auto", "default", WITHOUT_BYPASS),
      planToDefault: shiftTabCount("plan", "default", WITHOUT_BYPASS),
      planToDefaultWithoutAuto: shiftTabCount("plan", "default", [
        "default",
        "acceptEdits",
        "plan",
      ]),
      unavailableTarget: shiftTabCount("default", "bypassPermissions", WITHOUT_BYPASS),
      unknownCurrent: shiftTabCount("dontAsk", "plan", WITH_BYPASS),
    }).toStrictEqual({
      autoToDefault: 1,
      planToDefault: 2,
      planToDefaultWithoutAuto: 1,
      unavailableTarget: null,
      unknownCurrent: null,
    });
  });
});

describe("canApplyLive", () => {
  it("steers only an idle live pane that accepts writes", () => {
    expect({
      idle: canApplyLive({ hasLivePane: true, writesEnabled: true, working: false }),
      working: canApplyLive({ hasLivePane: true, writesEnabled: true, working: true }),
      writesDisabled: canApplyLive({ hasLivePane: true, writesEnabled: false, working: false }),
      noPane: canApplyLive({ hasLivePane: false, writesEnabled: true, working: false }),
    }).toStrictEqual({ idle: true, working: false, writesDisabled: false, noPane: false });
  });
});

function request(body: unknown): Request {
  return new Request("http://127.0.0.1:7599/api/herdr/live-option", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dependencies(
  sendRequest: HerdrRequester,
  overrides: Partial<HerdrLiveOptionDependencies> = {},
): HerdrLiveOptionDependencies {
  return {
    rejectRequest: rejectCrossSite,
    writesEnabled: () => true,
    resolveTarget: async () => ({
      ok: true,
      value: { terminalId: "terminal-test-200", paneId: "w200:p200" },
    }),
    request: sendRequest,
    createRequestId: () => "ccp:live-option:test-200",
    ...overrides,
  };
}

async function callHandler(
  body: unknown,
  overrides: Partial<HerdrLiveOptionDependencies> = {},
): Promise<{ status: number; body: unknown; herdrCalls: unknown[] }> {
  const sendRequest = vi.fn<HerdrRequester>(async () => ({ ok: true, value: { type: "ok" } }));
  const response = await handleHerdrLiveOption(request(body), dependencies(sendRequest, overrides));
  return {
    status: response.status,
    body: await response.json(),
    herdrCalls: sendRequest.mock.calls.map(([call]) => call),
  };
}

describe("herdr live-option handler", () => {
  it("prompts /model and /effort and presses shift+tab N times", async () => {
    const model = await callHandler({
      sessionId: "session-grace",
      change: { kind: "model", model: "claude-opus-5-5" },
    });
    const effort = await callHandler({
      sessionId: "session-grace",
      change: { kind: "effort", effort: "xhigh" },
    });
    const mode = await callHandler({
      sessionId: "session-grace",
      change: { kind: "mode", presses: 3 },
    });

    expect({ model, effort, mode }).toStrictEqual({
      model: {
        status: 200,
        body: { ok: true },
        herdrCalls: [
          {
            id: "ccp:live-option:test-200",
            method: "agent.prompt",
            params: { target: "w200:p200", text: "/model claude-opus-5-5" },
          },
        ],
      },
      effort: {
        status: 200,
        body: { ok: true },
        herdrCalls: [
          {
            id: "ccp:live-option:test-200",
            method: "agent.prompt",
            params: { target: "w200:p200", text: "/effort xhigh" },
          },
        ],
      },
      mode: {
        status: 200,
        body: { ok: true },
        herdrCalls: [
          {
            id: "ccp:live-option:test-200",
            method: "agent.send_keys",
            params: { target: "w200:p200", keys: ["shift+tab", "shift+tab", "shift+tab"] },
          },
        ],
      },
    });
  });

  it("rejects injected model text, out-of-range presses and disabled writes without touching herdr", async () => {
    const injected = await callHandler({
      sessionId: "session-grace",
      change: { kind: "model", model: "opus\n/clear" },
    });
    const tooMany = await callHandler({
      sessionId: "session-grace",
      change: { kind: "mode", presses: 5 },
    });
    const zero = await callHandler({
      sessionId: "session-grace",
      change: { kind: "mode", presses: 0 },
    });
    const disabled = await callHandler(
      { sessionId: "session-grace", change: { kind: "effort", effort: "low" } },
      { writesEnabled: () => false },
    );

    const invalid = {
      status: 400,
      body: { error: "sessionId and a model, effort or mode change are required" },
      herdrCalls: [],
    };
    expect({ injected, tooMany, zero, disabled }).toStrictEqual({
      injected: invalid,
      tooMany: invalid,
      zero: invalid,
      disabled: { status: 403, body: { error: "herdr writes are disabled" }, herdrCalls: [] },
    });
  });
});

describe("sendHerdrLiveOption", () => {
  it("posts the change as same-origin JSON", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));

    await sendHerdrLiveOption("session-heidi", { kind: "mode", presses: 2 }, fetcher);

    expect(fetcher.mock.calls).toStrictEqual([
      [
        "/api/herdr/live-option",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "session-heidi",
            change: { kind: "mode", presses: 2 },
          }),
        },
      ],
    ]);
  });
});
