import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import { TRANSCRIPT_WINDOW_MAX_RECORDS } from "../src/lib/structured-transcript";

/**
 * Tests for `/api/sessions/$id/transcript`. A megabyte-scale session used to
 * arrive in one response, and nothing painted until all of it had: the endpoint
 * now serves the tail and the client pages backwards with `?before=`.
 */

type ApiHandler = (context: {
  params: { id: string };
  request: Request;
}) => Response | Promise<Response>;

const PAYLOAD_CEILING_BYTES = 1024 * 1024;

let tempDir: string;
let db: AppDb;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "api-session-transcript-test-"));
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
  vi.doUnmock("../src/lib/db");
  vi.resetModules();
});

async function getTranscript(sessionId: string, query = ""): Promise<Response> {
  vi.doMock("../src/lib/db", () => ({ getDb: () => db }));
  const { Route } = await import("../src/routes/api/sessions.$id.transcript");
  const handlers = (
    Route as unknown as { options: { server: { handlers: Record<string, ApiHandler> } } }
  ).options.server.handlers;
  return handlers["GET"]!({
    params: { id: sessionId },
    request: new Request(`http://localhost/api/sessions/${sessionId}/transcript${query}`),
  });
}

function record(index: number): Record<string, unknown> {
  return {
    type: "user",
    uuid: `u-${index}`,
    // Roughly 4 KB per record: a few hundred of these is the multi-megabyte
    // JSONL this endpoint used to ship whole.
    message: { role: "user", content: "x".repeat(4_000) },
  };
}

function seedSession(sessionId: string, records: unknown[]): void {
  const filePath = join(tempDir, `${sessionId}.jsonl`);
  writeFileSync(filePath, records.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  db.index
    .insert(schema.sessions)
    .values({
      id: sessionId,
      projectId: "test-project",
      title: sessionId,
      createdAt: 0,
      mtimeMs: 0,
      filePath,
    })
    .run();
}

describe("GET /api/sessions/$id/transcript", () => {
  it("caps a multi-megabyte session to a tail well under a megabyte", async () => {
    const records = Array.from({ length: 1_000 }, (_, i) => record(i));
    seedSession("big", records);

    const response = await getTranscript("big");
    const body = await response.text();
    const parsed = JSON.parse(body) as { records: unknown[]; startIndex: number };

    expect(body.length).toBeLessThan(PAYLOAD_CEILING_BYTES);
    expect(parsed.records.length).toBeLessThan(records.length);
    expect(parsed.records.at(-1)).toStrictEqual(records.at(-1));
    expect(parsed.startIndex).toBe(records.length - parsed.records.length);
  });

  it("serves the records before the window when the client pages backwards", async () => {
    const records = Array.from({ length: TRANSCRIPT_WINDOW_MAX_RECORDS + 12 }, (_, i) => ({
      type: "user",
      uuid: `u-${i}`,
      message: { role: "user", content: `m${i}` },
    }));
    seedSession("paged", records);

    const tail = (await (await getTranscript("paged")).json()) as { startIndex: number };
    const earlier = (await (await getTranscript("paged", `?before=${tail.startIndex}`)).json()) as {
      records: unknown[];
      startIndex: number;
      precedingMessageCount: number;
    };

    expect(tail.startIndex).toBe(12);
    expect(earlier.records).toStrictEqual(records.slice(0, 12));
    expect(earlier.startIndex).toBe(0);
    expect(earlier.precedingMessageCount).toBe(0);
  });

  it("ignores a malformed before parameter and serves the tail", async () => {
    const records = Array.from({ length: 3 }, (_, i) => ({
      type: "user",
      uuid: `u-${i}`,
      message: { role: "user", content: `m${i}` },
    }));
    seedSession("small", records);

    const body = (await (await getTranscript("small", "?before=nonsense")).json()) as {
      records: unknown[];
      startIndex: number;
    };

    expect(body.records).toStrictEqual(records);
    expect(body.startIndex).toBe(0);
  });
});
