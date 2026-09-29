import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import { indexFile } from "../src/lib/db/indexer";
import { readSession } from "../src/lib/sessions";
import { renameSession } from "../src/lib/session-rename";

type ApiHandler = (context: {
  params: { id: string };
  request: Request;
}) => Response | Promise<Response>;

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const PROJECT = "-Users-test-proj";

let home: string;
let projectsDir: string;
let sessionPath: string;
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  broadcasts: [] as Array<{ type: string; data: Record<string, unknown> }>,
}));

vi.mock("../src/lib/db", () => ({ getDb: () => state.db }));
vi.mock("../src/lib/sse-broadcast", () => ({
  broadcastTyped: (type: string, data: Record<string, unknown>) => {
    state.broadcasts.push({ type, data });
  },
  broadcast: () => {
    state.broadcasts.push({ type: "content:updated", data: {} });
  },
}));

let db: AppDb;

const initialRecords = [
  {
    type: "user",
    uuid: "u-1",
    sessionId: SESSION_ID,
    timestamp: "2026-09-01T00:00:00.000Z",
    cwd: "/Users/test/proj",
    message: { role: "user", content: "Fix the flaky build" },
  },
  {
    type: "assistant",
    uuid: "a-1",
    parentUuid: "u-1",
    sessionId: SESSION_ID,
    timestamp: "2026-09-01T00:00:01.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "On it." }] },
  },
];

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "api-session-title-test-"));
  vi.stubEnv("HOME", home);
  projectsDir = join(home, ".claude", "projects");
  await mkdir(join(projectsDir, PROJECT), { recursive: true });
  sessionPath = join(projectsDir, PROJECT, `${SESSION_ID}.jsonl`);
  await writeFile(sessionPath, initialRecords.map((r) => JSON.stringify(r)).join("\n") + "\n");
  db = openTestDb();
  state.db = db;
  await indexFile(db.index, sessionPath, projectsDir);
  state.broadcasts.length = 0;
});

afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function loadPut(): Promise<ApiHandler> {
  const { Route } = await import("../src/routes/api/sessions.$id.title");
  const handlers = (
    Route as unknown as { options: { server: { handlers: Record<string, ApiHandler> } } }
  ).options.server.handlers;
  return handlers["PUT"]!;
}

async function putTitle(
  sessionId: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const put = await loadPut();
  return put({
    params: { id: sessionId },
    request: new Request(`http://localhost/api/sessions/${sessionId}/title`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  });
}

async function readLines(): Promise<string[]> {
  const raw = await readFile(sessionPath, "utf-8");
  expect(raw.endsWith("\n")).toBe(true);
  return raw.slice(0, -1).split("\n");
}

const sidecarPath = () => join(projectsDir, PROJECT, SESSION_ID, "custom-title.json");

function indexedTitles(): { title: string; customTitle: string | null } | undefined {
  return db.index
    .select({ title: schema.sessions.title, customTitle: schema.sessions.customTitle })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, SESSION_ID))
    .get();
}

describe("PUT /api/sessions/$id/title", () => {
  it("appends exactly one trimmed custom-title record and writes the CLI sidecar", async () => {
    const before = await readLines();

    const response = await putTitle(SESSION_ID, { title: "  Build fixer  " });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ customTitle: "Build fixer", title: "Build fixer" });
    const after = await readLines();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual([
      JSON.stringify({ type: "custom-title", customTitle: "Build fixer", sessionId: SESSION_ID }),
    ]);
    expect(await readFile(sidecarPath(), "utf-8")).toBe('{"customTitle":"Build fixer"}');
  });

  it("reindexes and broadcasts so the rename is visible last-wins", async () => {
    await putTitle(SESSION_ID, { title: "First name" });
    await putTitle(SESSION_ID, { title: "Second name" });

    expect(indexedTitles()).toEqual({ title: "Second name", customTitle: "Second name" });
    const detail = await readSession(projectsDir, SESSION_ID);
    expect(detail?.title).toBe("Second name");
    const updates = state.broadcasts.filter((b) => b.type === "session:updated");
    expect(updates.map((b) => (b.data["session"] as { title: string }).title)).toEqual([
      "First name",
      "Second name",
    ]);
  });

  it("an empty title appends an empty record, deletes the sidecar, and reverts to the auto title", async () => {
    await putTitle(SESSION_ID, { title: "Named" });
    expect(existsSync(sidecarPath())).toBe(true);
    const before = await readLines();

    const response = await putTitle(SESSION_ID, { title: "   " });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ customTitle: null, title: "Fix the flaky build" });
    expect((await readLines()).slice(before.length)).toEqual([
      JSON.stringify({ type: "custom-title", customTitle: "", sessionId: SESSION_ID }),
    ]);
    expect(existsSync(sidecarPath())).toBe(false);
    expect(indexedTitles()).toEqual({ title: "Fix the flaky build", customTitle: null });
    expect((await readSession(projectsDir, SESSION_ID))?.title).toBe("Fix the flaky build");
  });

  it("an empty title with no existing sidecar still succeeds", async () => {
    const response = await putTitle(SESSION_ID, { title: "" });
    expect(response.status).toBe(200);
    expect(existsSync(sidecarPath())).toBe(false);
  });

  it("starts the record on a fresh line when the transcript lacks a trailing newline", async () => {
    await writeFile(sessionPath, JSON.stringify(initialRecords[0]));

    await putTitle(SESSION_ID, { title: "Recovered" });

    expect(await readLines()).toEqual([
      JSON.stringify(initialRecords[0]),
      JSON.stringify({ type: "custom-title", customTitle: "Recovered", sessionId: SESSION_ID }),
    ]);
  });

  it("does not corrupt lines when renames interleave with a live writer", async () => {
    const writerLines = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({ type: "user", uuid: `live-${i}`, message: { content: "y".repeat(2000) } }),
    );
    const writer = (async () => {
      for (const line of writerLines) await appendFile(sessionPath, line + "\n");
    })();
    const renames = Array.from({ length: 10 }, (_, i) =>
      renameSession({
        db: db.index,
        claudeDir: join(home, ".claude"),
        sessionId: SESSION_ID,
        title: `Name ${i}`,
        broadcast: () => {},
      }),
    );
    await Promise.all([writer, ...renames]);

    const lines = await readLines();
    const parsed = lines.map((line) => JSON.parse(line) as { type: string; uuid?: string });
    expect(
      parsed
        .filter((r) => r.type === "custom-title")
        .map((r) => (r as { customTitle?: string }).customTitle)
        .sort(),
    ).toEqual(Array.from({ length: 10 }, (_, i) => `Name ${i}`));
    expect(parsed.filter((r) => r.uuid?.startsWith("live-")).map((r) => r.uuid)).toEqual(
      writerLines.map((_, i) => `live-${i}`),
    );
  });

  it("rejects a cross-site request without touching the transcript", async () => {
    const before = await readFile(sessionPath, "utf-8");

    const response = await putTitle(
      SESSION_ID,
      { title: "Hijacked" },
      { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    );

    expect(response.status).toBe(403);
    expect(await readFile(sessionPath, "utf-8")).toBe(before);
    expect(existsSync(sidecarPath())).toBe(false);
  });

  it("returns 404 for an unknown session", async () => {
    const response = await putTitle("99999999-0000-0000-0000-000000000000", { title: "x" });
    expect(response.status).toBe(404);
  });

  it("returns 404 for a subagent or path-shaped id", async () => {
    expect((await putTitle("agent-abc", { title: "x" })).status).toBe(404);
    expect((await putTitle("../etc", { title: "x" })).status).toBe(404);
  });

  it("rejects a body with unknown keys or a non-string title", async () => {
    const before = await readFile(sessionPath, "utf-8");
    expect((await putTitle(SESSION_ID, { title: "x", extra: 1 })).status).toBe(400);
    expect((await putTitle(SESSION_ID, { title: 5 })).status).toBe(400);
    expect(await readFile(sessionPath, "utf-8")).toBe(before);
  });
});
