import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import { TRANSCRIPT_WINDOW_MAX_RECORDS } from "../src/lib/structured-transcript";

/**
 * Tests for `/api/sessions/$id/resources`. The transcript endpoint serves only
 * a window, so the browser's own file and link extraction can report a floor at
 * best; this endpoint scans the whole JSONL so an opened drawer shows the
 * session's complete inventory.
 */

type ApiHandler = (context: { params: { id: string } }) => Response | Promise<Response>;

const HOME_ROOT = "/home/testuser";

let tempDir: string;
let db: AppDb;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "api-session-resources-test-"));
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
  vi.doUnmock("../src/lib/db");
  vi.doUnmock("node:os");
  vi.resetModules();
});

async function getResources(sessionId: string): Promise<Response> {
  vi.doMock("../src/lib/db", () => ({ getDb: () => db }));
  const os = await vi.importActual<typeof import("node:os")>("node:os");
  vi.doMock("node:os", () => ({ ...os, homedir: () => HOME_ROOT, default: os }));
  const { Route } = await import("../src/routes/api/sessions.$id.resources");
  const handlers = (
    Route as unknown as { options: { server: { handlers: Record<string, ApiHandler> } } }
  ).options.server.handlers;
  return handlers["GET"]!({ params: { id: sessionId } });
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

function userRecord(index: number, text: string): Record<string, unknown> {
  return {
    type: "user",
    uuid: `u-${index}`,
    message: { role: "user", content: text },
  };
}

describe("GET /api/sessions/$id/resources", () => {
  it("finds files and links in records the transcript window never serves", async () => {
    const filler = Array.from({ length: TRANSCRIPT_WINDOW_MAX_RECORDS + 50 }, (_, index) =>
      userRecord(index + 1, `filler ${index}`),
    );
    const records = [
      userRecord(0, `See ${HOME_ROOT}/projects/early.txt and https://example.com/early`),
      ...filler,
    ];
    seedSession("long", records);

    const body = (await (await getResources("long")).json()) as {
      files: { files: Array<{ path: string; occurrences: unknown[] }>; totalCount: number };
      links: Array<{ url: string; label: string; occurrences: unknown[] }>;
    };

    expect({
      files: body.files.files,
      totalCount: body.files.totalCount,
      links: body.links,
    }).toStrictEqual({
      files: [
        {
          path: "~/projects/early.txt",
          absolutePath: `${HOME_ROOT}/projects/early.txt`,
          occurrences: [{ source: "visible", anchorIndex: 0, anchorUuid: "u-0", role: "user" }],
        },
      ],
      totalCount: 1,
      links: [
        {
          url: "https://example.com/early",
          label: "example.com/early",
          occurrences: [{ source: "visible", anchorIndex: 0, anchorUuid: "u-0", role: "user" }],
        },
      ],
    });
  });

  it("serves one link occurrence per message however often the message repeats it", async () => {
    const repeated = Array.from({ length: 200 }, () => "https://example.com/spec").join("\n");
    seedSession("repeats", [userRecord(0, repeated)]);

    const body = (await (await getResources("repeats")).json()) as {
      links: Array<{ url: string; occurrences: unknown[] }>;
    };

    expect(body.links).toStrictEqual([
      {
        url: "https://example.com/spec",
        label: "example.com/spec",
        occurrences: [{ source: "visible", anchorIndex: 0, anchorUuid: "u-0", role: "user" }],
      },
    ]);
  });

  it("returns an empty inventory for an unknown session", async () => {
    const body = (await (await getResources("missing")).json()) as {
      files: { totalCount: number };
      links: unknown[];
    };

    expect({ totalCount: body.files.totalCount, links: body.links }).toStrictEqual({
      totalCount: 0,
      links: [],
    });
  });
});
