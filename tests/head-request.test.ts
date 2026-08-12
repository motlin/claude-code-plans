import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { withHeadBodyCancel } from "../src/lib/head-request";
import { sseClientCount } from "../src/lib/sse-broadcast";
import { Route as EventsRoute } from "../src/routes/api/events";

type ApiHandler = (context: { request: Request }) => Response | Promise<Response>;

function resolveHeadHandler(route: unknown): ApiHandler {
  const handlers = (
    route as { options: { server: { handlers: Record<string, ApiHandler | undefined> } } }
  ).options.server.handlers;
  const handler = handlers["HEAD"] ?? handlers["GET"] ?? handlers["ANY"];
  if (!handler) throw new Error("Route declares no handler reachable from HEAD");
  return handler;
}

/**
 * Stands in for a body that is only torn down when the consumer pulls it to
 * completion or cancels it — the shape of TanStack's SSR transform stream and
 * of the `/api/events` SSE stream.
 */
function neverEndingStream(onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull() {
      return new Promise<void>(() => {});
    },
    cancel() {
      onCancel();
    },
  });
}

describe("withHeadBodyCancel", () => {
  it("cancels a streaming HEAD body instead of leaving it open", async () => {
    let cancelled = false;
    const fetchImpl = (): Response =>
      new Response(
        neverEndingStream(() => {
          cancelled = true;
        }),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );

    const response = await withHeadBodyCancel(fetchImpl)(
      new Request("http://localhost/", { method: "HEAD" }),
    );

    expect({
      body: response.body,
      cancelled,
      contentType: response.headers.get("Content-Type"),
      status: response.status,
    }).toStrictEqual({
      body: null,
      cancelled: true,
      contentType: "text/html",
      status: 200,
    });
  });

  it("passes GET responses through untouched", async () => {
    const original = new Response("<html></html>", { status: 200 });

    const response = await withHeadBodyCancel(() => original)(
      new Request("http://localhost/", { method: "GET" }),
    );

    expect(response).toBe(original);
    expect(await response.text()).toBe("<html></html>");
  });

  it("passes a bodiless HEAD response through untouched", async () => {
    const original = new Response(null, { status: 405, headers: { Allow: "POST" } });

    const response = await withHeadBodyCancel(() => original)(
      new Request("http://localhost/api/capabilities", { method: "HEAD" }),
    );

    expect(response).toBe(original);
  });

  it("swallows a body whose cancel() rejects", async () => {
    const fetchImpl = (): Response =>
      new Response(
        new ReadableStream({
          pull() {
            return new Promise<void>(() => {});
          },
          cancel() {
            throw new Error("cancel exploded");
          },
        }),
        { status: 200 },
      );

    const response = await withHeadBodyCancel(fetchImpl)(
      new Request("http://localhost/", { method: "HEAD" }),
    );

    expect({ body: response.body, status: response.status }).toStrictEqual({
      body: null,
      status: 200,
    });
  });
});

describe("HEAD /api/events", () => {
  it("does not leak an SSE client or its keepalive interval", async () => {
    const handler = resolveHeadHandler(EventsRoute);
    const before = sseClientCount();

    const response = await withHeadBodyCancel((request) => handler({ request }))(
      new Request("http://localhost/api/events", { method: "HEAD" }),
    );

    expect({ body: response.body, clients: sseClientCount() }).toStrictEqual({
      body: null,
      clients: before,
    });
  });
});

describe("server entry", () => {
  it("routes every request through withHeadBodyCancel", () => {
    const source = readFileSync(resolve(__dirname, "../src/server.ts"), "utf8");

    expect(source).toContain('from "./lib/head-request"');
    expect(source).toContain("withHeadBodyCancel(");
  });
});
