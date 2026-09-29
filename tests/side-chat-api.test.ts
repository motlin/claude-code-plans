import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";

const spawnMock = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ db: undefined as unknown, broadcasts: 0 }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../src/lib/db", () => ({ getDb: () => state.db }));
vi.mock("../src/lib/watcher", () => ({
  broadcast: () => {
    state.broadcasts += 1;
  },
}));

import { spawnClaude } from "../src/lib/cli-runner";
import { buildSideChatPrompt } from "../src/lib/side-chat";

type ApiHandler = (context: { request: Request }) => Response | Promise<Response>;

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const PROJECT = "-Users-alice-proj";

let home: string;
let projectsDir: string;
let db: AppDb;

function fakeChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

beforeEach(async () => {
  spawnMock.mockReset();
  state.broadcasts = 0;
  home = mkdtempSync(join(tmpdir(), "side-chat-api-test-"));
  vi.stubEnv("HOME", home);
  projectsDir = join(home, ".claude", "projects");
  await mkdir(join(projectsDir, PROJECT), { recursive: true });
  const sessionPath = join(projectsDir, PROJECT, `${SESSION_ID}.jsonl`);
  const records = [
    {
      type: "user",
      uuid: "u-1",
      sessionId: SESSION_ID,
      timestamp: "2026-09-01T00:00:00.000Z",
      cwd: "/Users/alice/proj",
      message: { role: "user", content: "Fix the flaky build" },
    },
  ];
  await writeFile(sessionPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  db = openTestDb();
  state.db = db;
  db.index
    .insert(schema.projects)
    .values({ id: PROJECT, name: "proj", projectPath: "/Users/alice/proj", updatedAt: 0 })
    .run();
  db.index
    .insert(schema.sessions)
    .values({
      id: SESSION_ID,
      projectId: PROJECT,
      title: "Fix the flaky build",
      firstPrompt: "Fix the flaky build",
      summary: null,
      customTitle: null,
      messageCount: 1,
      gitBranch: null,
      cwd: "/Users/alice/proj",
      isSidechain: 0,
      createdAt: 1_788_220_800_000,
      mtimeMs: 1_788_220_800_000,
      filePath: sessionPath,
    })
    .run();
});

afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function post(body: unknown): Promise<Response> {
  const { Route } = await import("../src/routes/api/side-chat");
  const handlers = (
    Route as unknown as { options: { server: { handlers: Record<string, ApiHandler> } } }
  ).options.server.handlers;
  return handlers["POST"]!({
    request: new Request("http://localhost/api/side-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

describe("spawnClaude ephemeral option", () => {
  it("appends --no-session-persistence only when ephemeral", () => {
    spawnMock.mockImplementation(() => fakeChildProcess());
    const base = {
      sessionId: SESSION_ID,
      prompt: "What does the build do?",
      projectDir: "/Users/alice/proj",
      environment: {},
    };

    spawnClaude(base);
    spawnClaude({ ...base, ephemeral: true });

    const expectedBase = [
      "--resume",
      SESSION_ID,
      "--fork-session",
      "-p",
      "What does the build do?",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    expect(spawnMock.mock.calls.map((call) => call[1])).toStrictEqual([
      expectedBase,
      [...expectedBase, "--no-session-persistence"],
    ]);
  });
});

describe("buildSideChatPrompt", () => {
  it("returns the bare question when there are no prior messages", () => {
    expect(buildSideChatPrompt([], "Why is the build flaky?")).toBe("Why is the build flaky?");
  });

  it("prepends prior Q/A pairs as a quoted preamble", () => {
    expect(
      buildSideChatPrompt(
        [
          { q: "Why is the build flaky?", a: "A race in the watcher.\nSee watcher.ts." },
          { q: "Which test?", a: "watcher.test.ts" },
        ],
        "How do I fix it?",
      ),
    ).toBe(
      [
        "Earlier in this side chat:",
        "",
        "> Q: Why is the build flaky?",
        "> A: A race in the watcher.",
        "> See watcher.ts.",
        ">",
        "> Q: Which test?",
        "> A: watcher.test.ts",
        "",
        "How do I fix it?",
      ].join("\n"),
    );
  });
});

describe("POST /api/side-chat", () => {
  it("returns 400 when the question is missing", async () => {
    const response = await post({ sessionId: SESSION_ID, messages: [] });
    expect({ status: response.status, body: await response.json() }).toStrictEqual({
      status: 400,
      body: { error: "sessionId and question are required" },
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the question is blank", async () => {
    const response = await post({ sessionId: SESSION_ID, messages: [], question: "   " });
    expect(response.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown session", async () => {
    const response = await post({
      sessionId: "99999999-0000-0000-0000-000000000000",
      messages: [],
      question: "Why?",
    });
    expect({ status: response.status, body: await response.json() }).toStrictEqual({
      status: 404,
      body: { error: "Could not determine project directory for session" },
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("streams an ephemeral forked answer and writes no JSONL", async () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const before = await readdir(join(projectsDir, PROJECT));

    const response = await post({
      sessionId: SESSION_ID,
      messages: [{ q: "Why is the build flaky?", a: "A race." }],
      question: "How do I fix it?",
    });
    child.stdout!.emit("data", Buffer.from('{"type":"result"}\n'));
    child.emit("close", 0);

    expect({
      status: response.status,
      contentType: response.headers.get("Content-Type"),
      hasProcessId: response.headers.get("X-Process-Id")?.startsWith(`${SESSION_ID}-`),
      body: await response.text(),
    }).toStrictEqual({
      status: 200,
      contentType: "application/x-ndjson",
      hasProcessId: true,
      body: '{"type":"result"}\n',
    });
    expect(spawnMock.mock.calls).toStrictEqual([
      [
        "claude",
        [
          "--resume",
          SESSION_ID,
          "--fork-session",
          "-p",
          "Earlier in this side chat:\n\n> Q: Why is the build flaky?\n> A: A race.\n\nHow do I fix it?",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--no-session-persistence",
        ],
        expect.objectContaining({ cwd: "/Users/alice/proj" }),
      ],
    ]);
    expect(await readdir(join(projectsDir, PROJECT))).toStrictEqual(before);
    expect(state.broadcasts).toBe(0);
  });

  it("cancels a running side question", async () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const started = await post({ sessionId: SESSION_ID, messages: [], question: "Why?" });
    const processId = started.headers.get("X-Process-Id");

    const cancelled = await post({ action: "cancel", processId });

    expect(await cancelled.json()).toStrictEqual({ ok: true });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
