import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";

/**
 * Tests for `/api/sessions/$id` when the id names a subagent rather than a
 * session. The row the endpoint falls back to carries the model that agent ran
 * on, which the detail header names beside its attribution agent.
 */

type ApiHandler = (context: { params: { id: string } }) => Response | Promise<Response>;

const HOME_ROOT = "/home/testuser";

let db: AppDb;

beforeEach(() => {
  db = openTestDb();
});

afterEach(() => {
  db.close();
  vi.doUnmock("../src/lib/db");
  vi.doUnmock("node:os");
  vi.resetModules();
});

async function getDetail(id: string): Promise<Response> {
  vi.doMock("../src/lib/db", () => ({ getDb: () => db }));
  const os = await vi.importActual<typeof import("node:os")>("node:os");
  vi.doMock("node:os", () => ({ ...os, homedir: () => HOME_ROOT, default: os }));
  const { Route } = await import("../src/routes/api/sessions.$id");
  const handlers = (
    Route as unknown as { options: { server: { handlers: Record<string, ApiHandler> } } }
  ).options.server.handlers;
  return handlers["GET"]!({ params: { id } });
}

function seedSubagent(id: string, model: string | null): void {
  db.index
    .insert(schema.subagents)
    .values({
      id,
      sessionId: "session-parent",
      projectId: "project-test",
      parentAgentId: null,
      agentType: "Explore",
      attributionAgent: "markdown-tasks:do-task",
      slug: "explore-test",
      description: "Inspect test files",
      model,
      startedAt: "1999-12-31T00:00:05.000Z",
      finishedAt: "1999-12-31T00:00:15.000Z",
      filePath: `/tmp/test/${id}.jsonl`,
      mtimeMs: 1_000,
    })
    .run();
}

describe("GET /api/sessions/$id for a subagent", () => {
  it("carries the model that agent ran on", async () => {
    seedSubagent("agent-haiku", "claude-haiku-4-5-20251001");

    const body = (await (await getDetail("agent-haiku")).json()) as { model?: string };

    expect(body.model).toStrictEqual("claude-haiku-4-5-20251001");
  });

  it("omits the model when the agent named none", async () => {
    seedSubagent("agent-unknown", null);

    const body = (await (await getDetail("agent-unknown")).json()) as { model?: string };

    expect(body.model).toStrictEqual(undefined);
  });
});
