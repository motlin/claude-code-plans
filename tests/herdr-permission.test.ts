import { describe, expect, it, vi } from "vite-plus/test";
import {
  handleHerdrPermission,
  type HerdrPermissionDependencies,
} from "../src/lib/herdr/permission";
import type { HerdrRequester } from "../src/lib/herdr/panes";
import { rejectCrossSite } from "../src/lib/same-origin-guard";

function request(body: unknown, headers?: HeadersInit): Request {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Content-Type", "application/json");
  return new Request("http://127.0.0.1:7526/api/herdr/permission", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

async function describeResponse(response: Response): Promise<{ body: unknown; status: number }> {
  return { body: await response.json(), status: response.status };
}

function dependencies(
  overrides: Partial<HerdrPermissionDependencies> = {},
): HerdrPermissionDependencies {
  return {
    rejectRequest: rejectCrossSite,
    writesEnabled: () => true,
    hasPendingPermission: () => true,
    clearPendingPermission: () => {},
    resolveTarget: async () => ({
      ok: true,
      value: { terminalId: "terminal-test-100", paneId: "w100:p100" },
    }),
    request: async () => ({ ok: true, value: { type: "ok" } }),
    createRequestId: () => "ccp:permission:test-100",
    ...overrides,
  };
}

describe("herdr permission decision handler", () => {
  it("returns before resolving when writes are disabled", async () => {
    const sendRequest = vi.fn<HerdrRequester>();
    const response = await handleHerdrPermission(
      request({ sessionId: "session-test-100", decision: "allow" }),
      dependencies({ writesEnabled: () => false, request: sendRequest }),
    );
    expect({
      response: await describeResponse(response),
      sendRequestCalls: sendRequest.mock.calls,
    }).toStrictEqual({
      response: { body: { error: "herdr writes are disabled" }, status: 403 },
      sendRequestCalls: [],
    });
  });

  it("rejects cross-site requests", async () => {
    const response = await handleHerdrPermission(
      request(
        { sessionId: "session-test-100", decision: "allow" },
        { Origin: "https://attacker.example.com", "Sec-Fetch-Site": "cross-site" },
      ),
      dependencies(),
    );
    expect(response.status).toStrictEqual(403);
  });

  it.each([
    { body: { sessionId: "session-test-100" }, name: "missing decision" },
    { body: { sessionId: "", decision: "allow" }, name: "empty session id" },
    { body: { sessionId: "session-test-100", decision: "always" }, name: "unknown decision" },
    {
      body: { sessionId: "session-test-100", decision: "allow", keys: ["ctrl+c"] },
      name: "caller-supplied keys",
    },
  ])("returns 400 for $name", async ({ body }) => {
    const sendRequest = vi.fn<HerdrRequester>();
    const response = await handleHerdrPermission(
      request(body),
      dependencies({ request: sendRequest }),
    );
    expect({
      response: await describeResponse(response),
      sendRequestCalls: sendRequest.mock.calls,
    }).toStrictEqual({
      response: {
        body: { error: 'sessionId is required and decision must be "allow" or "deny"' },
        status: 400,
      },
      sendRequestCalls: [],
    });
  });

  it("refuses to type into a pane that is not at a permission prompt", async () => {
    const sendRequest = vi.fn<HerdrRequester>();
    const response = await handleHerdrPermission(
      request({ sessionId: "session-test-100", decision: "allow" }),
      dependencies({ hasPendingPermission: () => false, request: sendRequest }),
    );
    expect({
      response: await describeResponse(response),
      sendRequestCalls: sendRequest.mock.calls,
    }).toStrictEqual({
      response: { body: { error: "No permission request is pending" }, status: 409 },
      sendRequestCalls: [],
    });
  });

  it.each([
    { decision: "allow", keys: ["1"] },
    { decision: "deny", keys: ["esc"] },
  ])("sends $keys for $decision and clears the pending prompt", async ({ decision, keys }) => {
    const requests: object[] = [];
    const cleared: string[] = [];
    const response = await handleHerdrPermission(
      request({ sessionId: "session-test-100", decision }),
      dependencies({
        request: async (value) => {
          requests.push(value);
          return { ok: true, value: { type: "ok" } };
        },
        clearPendingPermission: (sessionId) => cleared.push(sessionId),
      }),
    );
    expect({ response: await describeResponse(response), requests, cleared }).toStrictEqual({
      response: { body: { ok: true }, status: 200 },
      requests: [
        {
          id: "ccp:permission:test-100",
          method: "agent.send_keys",
          params: { target: "w100:p100", keys },
        },
      ],
      cleared: ["session-test-100"],
    });
  });

  it("keeps the prompt pending when herdr rejects the keys", async () => {
    const cleared: string[] = [];
    const response = await handleHerdrPermission(
      request({ sessionId: "session-test-100", decision: "allow" }),
      dependencies({
        request: async () => ({ ok: false, code: "agent_not_ready", message: "Fabricated" }),
        clearPendingPermission: (sessionId) => cleared.push(sessionId),
      }),
    );
    expect({ response: await describeResponse(response), cleared }).toStrictEqual({
      response: { body: { error: "Fabricated" }, status: 409 },
      cleared: [],
    });
  });
});
