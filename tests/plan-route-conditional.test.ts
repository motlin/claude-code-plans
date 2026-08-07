import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { isPlanNotModified, Route as PlanDetailRoute } from "../src/routes/api/plans.$filename";
import { Route as MemoryDetailRoute } from "../src/routes/api/projects.$id.memories.$filename";

const mockedHome = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async () => ({
  ...(await vi.importActual<typeof import("node:os")>("node:os")),
  homedir: () => mockedHome.path,
}));

interface DetailRouteContext {
  params: { filename: string; id?: string };
  request: Request;
}

type DetailRouteHandler = (context: DetailRouteContext) => Promise<Response>;

function getDetailRouteHandler(route: unknown): DetailRouteHandler {
  return (
    route as {
      options: { server: { handlers: { GET: DetailRouteHandler } } };
    }
  ).options.server.handlers.GET;
}

let fixtureDirectory: string;

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".llm"), { recursive: true });
  fixtureDirectory = mkdtempSync(join(process.cwd(), ".llm", "md-route-containment-test-"));
  mockedHome.path = fixtureDirectory;
  mkdirSync(join(fixtureDirectory, ".claude", "plans"), { recursive: true });
  mkdirSync(join(fixtureDirectory, ".claude", "projects", "alice-project", "memory"), {
    recursive: true,
  });
  writeFileSync(join(fixtureDirectory, ".claude", "CLAUDE.md"), "# Fabricated instructions\n");
});

afterEach(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

const futureIfModifiedSince = "Fri, 31 Dec 9999 23:59:59 GMT";

async function describeTraversalResponse(response: Response): Promise<{
  body: string;
  lastModified: string | null;
  status: number;
}> {
  return {
    body: await response.text(),
    lastModified: response.headers.get("Last-Modified"),
    status: response.status,
  };
}

describe("isPlanNotModified", () => {
  const mtime = new Date("2026-05-14T12:00:00.000Z");

  it("returns true when If-Modified-Since exactly matches the mtime floored to seconds", () => {
    expect(isPlanNotModified(mtime.toUTCString(), mtime)).toBe(true);
  });

  it("returns true when If-Modified-Since is strictly later than the mtime", () => {
    const later = new Date(mtime.getTime() + 5_000).toUTCString();
    expect(isPlanNotModified(later, mtime)).toBe(true);
  });

  it("returns true when the millisecond remainder of mtime is masked by HTTP-date precision", () => {
    // mtime carries sub-second precision; the header value is the same
    // instant truncated to seconds. The route is expected to floor
    // mtime before comparing, so this must still register as "not
    // modified".
    const fractional = new Date(mtime.getTime() + 750);
    expect(isPlanNotModified(mtime.toUTCString(), fractional)).toBe(true);
  });

  it("returns false when If-Modified-Since is strictly earlier than mtime", () => {
    const earlier = new Date(mtime.getTime() - 5_000).toUTCString();
    expect(isPlanNotModified(earlier, mtime)).toBe(false);
  });

  it("returns false when the header is missing", () => {
    expect(isPlanNotModified(null, mtime)).toBe(false);
  });

  it("returns false when the header is unparseable", () => {
    expect(isPlanNotModified("not a date", mtime)).toBe(false);
  });
});

describe("markdown detail route containment", () => {
  it("returns 404 without exposing plan metadata for a traversal filename", async () => {
    const response = await getDetailRouteHandler(PlanDetailRoute)({
      params: { filename: "../CLAUDE" },
      request: new Request("https://example.com/api/plans/..%2FCLAUDE", {
        headers: { "If-Modified-Since": futureIfModifiedSince },
      }),
    });

    expect(await describeTraversalResponse(response)).toStrictEqual({
      body: "Not Found",
      lastModified: null,
      status: 404,
    });
  });

  it("returns 404 without exposing memory metadata for a traversal filename", async () => {
    const response = await getDetailRouteHandler(MemoryDetailRoute)({
      params: { filename: "../../../CLAUDE", id: "alice-project" },
      request: new Request(
        "https://example.com/api/projects/alice-project/memories/..%2F..%2F..%2FCLAUDE",
        { headers: { "If-Modified-Since": futureIfModifiedSince } },
      ),
    });

    expect(await describeTraversalResponse(response)).toStrictEqual({
      body: "Not Found",
      lastModified: null,
      status: 404,
    });
  });
});
