import { describe, expect, it, vi } from "vite-plus/test";
import type { HerdrResult } from "../src/lib/herdr/client";
import { handleHerdrInterrupt, type HerdrInterruptDependencies } from "../src/lib/herdr/interrupt";
import type { HerdrRequester } from "../src/lib/herdr/panes";
import { rejectCrossSite } from "../src/lib/same-origin-guard";

function request(body: unknown, headers?: HeadersInit): Request {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Content-Type", "application/json");
  return new Request("http://127.0.0.1:7526/api/herdr/interrupt", {
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

function dependencies(
  overrides: Partial<HerdrInterruptDependencies> = {},
): HerdrInterruptDependencies {
  return {
    rejectRequest: rejectCrossSite,
    writesEnabled: () => true,
    resolveTarget: async () => ({
      ok: true,
      value: { terminalId: "terminal-test-100", paneId: "w100:p100" },
    }),
    request: async () => ({ ok: true, value: { type: "ok" } }),
    createRequestId: () => "ccp:interrupt:test-100",
    ...overrides,
  };
}

describe("herdr interrupt write handler", () => {
  it("returns before parsing or resolving when writes are disabled", async () => {
    const resolveTarget = vi.fn<HerdrInterruptDependencies["resolveTarget"]>();
    const sendRequest = vi.fn<HerdrRequester>();

    const response = await handleHerdrInterrupt(
      request({ sessionId: "session-test-100" }),
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

    const response = await handleHerdrInterrupt(
      request(
        { sessionId: "session-test-100" },
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

  it.each([
    { body: {}, name: "missing session id" },
    { body: { sessionId: "" }, name: "empty session id" },
    { body: { sessionId: "session-test-100", force: "true" }, name: "non-boolean force" },
    {
      body: { sessionId: "session-test-100", keys: ["prefix+x"] },
      name: "caller-supplied key list",
    },
  ])("returns 400 without resolving for $name", async ({ body }) => {
    const resolveTarget = vi.fn<HerdrInterruptDependencies["resolveTarget"]>();
    const sendRequest = vi.fn<HerdrRequester>();

    const response = await handleHerdrInterrupt(
      request(body),
      dependencies({ resolveTarget, request: sendRequest }),
    );

    expect({
      response: await describeResponse(response),
      resolveTargetCalls: resolveTarget.mock.calls,
      sendRequestCalls: sendRequest.mock.calls,
    }).toStrictEqual({
      response: {
        body: { error: "sessionId is required and force must be a boolean when provided" },
        status: 400,
      },
      resolveTargetCalls: [],
      sendRequestCalls: [],
    });
  });

  it.each([
    { body: { sessionId: "session-test-100" }, keys: ["esc"], name: "default interrupt" },
    {
      body: { sessionId: "session-test-100", force: false },
      keys: ["esc"],
      name: "explicit non-force interrupt",
    },
    {
      body: { sessionId: "session-test-100", force: true },
      keys: ["ctrl+c"],
      name: "explicit force quit",
    },
  ])("sends only the expected key for $name", async ({ body, keys }) => {
    const requests: object[] = [];
    const sendRequest: HerdrRequester = async (requestValue) => {
      requests.push(requestValue);
      return { ok: true, value: { type: "ok" } };
    };

    const response = await handleHerdrInterrupt(
      request(body),
      dependencies({ request: sendRequest }),
    );

    expect({ response: await describeResponse(response), requests }).toStrictEqual({
      response: { body: { ok: true }, status: 200 },
      requests: [
        {
          id: "ccp:interrupt:test-100",
          method: "agent.send_keys",
          params: { target: "w100:p100", keys },
        },
      ],
    });
  });

  it.each([
    { code: "agent_not_ready", status: 409 },
    { code: "invalid_key", status: 400 },
    { code: "agent_send_keys_failed", status: 502 },
    { code: "fabricated_transport_error", status: 502 },
  ])("maps $code to HTTP $status with the herdr reason", async ({ code, status }) => {
    const error: HerdrResult<unknown> = {
      ok: false,
      code,
      message: `Fabricated ${code} reason`,
    };

    const response = await handleHerdrInterrupt(
      request({ sessionId: "session-test-100" }),
      dependencies({ request: async () => error }),
    );

    expect(await describeResponse(response)).toStrictEqual({
      body: { error: `Fabricated ${code} reason` },
      status,
    });
  });

  it("does not send keys when durable target resolution fails", async () => {
    const sendRequest = vi.fn<HerdrRequester>();

    const response = await handleHerdrInterrupt(
      request({ sessionId: "session-test-100" }),
      dependencies({
        resolveTarget: async () => ({
          ok: false,
          code: "session-not-found",
          message: "Fabricated session is not attached to herdr",
        }),
        request: sendRequest,
      }),
    );

    expect({
      response: await describeResponse(response),
      sendRequestCalls: sendRequest.mock.calls,
    }).toStrictEqual({
      response: {
        body: { error: "Fabricated session is not attached to herdr" },
        status: 502,
      },
      sendRequestCalls: [],
    });
  });
});
