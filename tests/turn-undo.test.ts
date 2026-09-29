import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import { parseJsonlRecord, type JsonlRecord } from "../src/lib/schemas";
import { previewTurnUndo, undoTurn } from "../src/lib/turn-undo";
import { handleTurnUndoRequest } from "../src/lib/turn-undo-handler";

const SESSION_ID = "session-undo-100";

let directory: string;
let db: AppDb;

function record(value: Record<string, unknown>): JsonlRecord {
  const parsed = parseJsonlRecord(JSON.stringify(value));
  if (parsed === null) throw new Error(`Invalid JSONL fixture: ${JSON.stringify(value)}`);
  return parsed;
}

function userPrompt(uuid: string, text: string): JsonlRecord {
  return record({
    type: "user",
    uuid,
    parentUuid: null,
    sessionId: SESSION_ID,
    timestamp: "2026-09-29T00:00:00.000Z",
    message: { role: "user", content: text },
  });
}

function toolResult(uuid: string, toolUseResult: Record<string, unknown>): JsonlRecord {
  return record({
    type: "user",
    uuid,
    parentUuid: `assistant-${uuid}`,
    sessionId: SESSION_ID,
    timestamp: "2026-09-29T00:00:00.000Z",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `toolu_${uuid}`, content: "ok" }],
    },
    toolUseResult,
    sourceToolAssistantUUID: `assistant-${uuid}`,
  });
}

function editResult(filePath: string, originalFile: string | null, from: string, to: string) {
  return toolResult(`edit-${filePath}-${from}`, {
    filePath,
    oldString: from,
    newString: to,
    originalFile,
    structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [] }],
    userModified: false,
    replaceAll: false,
  });
}

function createResult(uuid: string, filePath: string, content: string): JsonlRecord {
  return toolResult(uuid, {
    type: "create",
    filePath,
    content,
    structuredPatch: [],
    originalFile: null,
  });
}

function path(name: string): string {
  return join(directory, name);
}

function read(name: string): string {
  return readFileSync(path(name), "utf8");
}

/** Turn 1 edits keep.txt; turn 2 edits keep.txt again and creates new.txt. */
function sessionRecords(): JsonlRecord[] {
  return [
    userPrompt("prompt-1", "First"),
    editResult(path("keep.txt"), "one\ntwo\n", "one", "ONE"),
    userPrompt("prompt-2", "Second"),
    editResult(path("keep.txt"), "ONE\ntwo\n", "two", "TWO"),
    createResult("create-new", path("new.txt"), "fresh\n"),
  ];
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "turn-undo-test-"));
  writeFileSync(path("keep.txt"), "ONE\nTWO\n");
  writeFileSync(path("new.txt"), "fresh\n");
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("previewTurnUndo", () => {
  it("lists the turn's files and whether each still matches the turn's result", async () => {
    expect(await previewTurnUndo(sessionRecords(), "prompt-2")).toStrictEqual({
      kind: "ok",
      files: [
        { path: path("keep.txt"), status: "modified", state: "ready" },
        { path: path("new.txt"), status: "added", state: "ready" },
      ],
    });
  });

  it("marks files changed or deleted since the turn as conflicts", async () => {
    writeFileSync(path("keep.txt"), "ONE\nTWO\nlater\n");
    rmSync(path("new.txt"));

    expect(await previewTurnUndo(sessionRecords(), "prompt-2")).toStrictEqual({
      kind: "ok",
      files: [
        { path: path("keep.txt"), status: "modified", state: "conflict" },
        { path: path("new.txt"), status: "added", state: "conflict" },
      ],
    });
  });

  it("marks files without a before snapshot as unknown", async () => {
    const records = [
      userPrompt("prompt-1", "First"),
      editResult(path("keep.txt"), null, "two", "TWO"),
    ];

    expect(await previewTurnUndo(records, "prompt-1")).toStrictEqual({
      kind: "ok",
      files: [{ path: path("keep.txt"), status: "modified", state: "unknown" }],
    });
  });

  it("reports an unknown turn", async () => {
    expect(await previewTurnUndo(sessionRecords(), "missing")).toStrictEqual({
      kind: "not-found",
    });
  });
});

describe("undoTurn", () => {
  it("writes the originals back and deletes files the turn created", async () => {
    expect(await undoTurn(sessionRecords(), "prompt-2", { confirm: true })).toStrictEqual({
      kind: "reverted",
      files: [path("keep.txt"), path("new.txt")],
    });

    expect(read("keep.txt")).toBe("ONE\ntwo\n");
    expect(existsSync(path("new.txt"))).toBe(false);
  });

  it("refuses without touching anything when any file changed since the turn", async () => {
    writeFileSync(path("new.txt"), "edited by hand\n");

    expect(await undoTurn(sessionRecords(), "prompt-2", { confirm: true })).toStrictEqual({
      kind: "blocked",
      files: [
        { path: path("keep.txt"), status: "modified", state: "ready" },
        { path: path("new.txt"), status: "added", state: "conflict" },
      ],
    });

    expect([read("keep.txt"), read("new.txt")]).toStrictEqual(["ONE\nTWO\n", "edited by hand\n"]);
  });

  it("requires confirmation before writing", async () => {
    expect(await undoTurn(sessionRecords(), "prompt-2", { confirm: false })).toStrictEqual({
      kind: "confirm-required",
    });

    expect([read("keep.txt"), read("new.txt")]).toStrictEqual(["ONE\nTWO\n", "fresh\n"]);
  });

  it("reports an unknown turn", async () => {
    expect(await undoTurn(sessionRecords(), "missing", { confirm: true })).toStrictEqual({
      kind: "not-found",
    });
  });
});

function insertSession(): void {
  db.index
    .insert(schema.projects)
    .values({ id: "project-undo-100", name: "example", projectPath: "/example", updatedAt: 0 })
    .run();
  db.index
    .insert(schema.sessions)
    .values({
      id: SESSION_ID,
      projectId: "project-undo-100",
      title: "Undo example",
      firstPrompt: null,
      summary: null,
      customTitle: null,
      messageCount: 5,
      gitBranch: null,
      cwd: directory,
      isSidechain: 0,
      createdAt: 946_598_400_000,
      mtimeMs: 946_684_800_000,
      filePath: `/transcripts/${SESSION_ID}.jsonl`,
    })
    .run();
}

function dependencies() {
  return { index: db.index, readRecords: async () => sessionRecords() };
}

function post(body: unknown): Request {
  return new Request(`http://localhost/api/sessions/${SESSION_ID}/turn-undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleTurnUndoRequest", () => {
  it("returns 404 for an unknown session", async () => {
    const response = await handleTurnUndoRequest(
      "missing",
      new Request("http://localhost/api/sessions/missing/turn-undo?turn=prompt-2"),
      dependencies(),
    );

    expect([response.status, await response.json()]).toStrictEqual([
      404,
      { error: "Session not found" },
    ]);
  });

  it("previews the turn's files on GET", async () => {
    insertSession();

    const response = await handleTurnUndoRequest(
      SESSION_ID,
      new Request(`http://localhost/api/sessions/${SESSION_ID}/turn-undo?turn=prompt-2`),
      dependencies(),
    );

    expect([response.status, await response.json()]).toStrictEqual([
      200,
      {
        files: [
          { path: path("keep.txt"), status: "modified", state: "ready" },
          { path: path("new.txt"), status: "added", state: "ready" },
        ],
      },
    ]);
  });

  it("returns 400 and writes nothing when the POST is not confirmed", async () => {
    insertSession();

    const response = await handleTurnUndoRequest(
      SESSION_ID,
      post({ turn: "prompt-2" }),
      dependencies(),
    );

    expect([response.status, await response.json()]).toStrictEqual([
      400,
      { error: "Confirmation required" },
    ]);
    expect(read("keep.txt")).toBe("ONE\nTWO\n");
  });

  it("returns 409 with the files when a file changed since the turn", async () => {
    insertSession();
    writeFileSync(path("keep.txt"), "changed\n");

    const response = await handleTurnUndoRequest(
      SESSION_ID,
      post({ turn: "prompt-2", confirm: true }),
      dependencies(),
    );

    expect([response.status, await response.json()]).toStrictEqual([
      409,
      {
        error: "Files changed since this turn",
        files: [
          { path: path("keep.txt"), status: "modified", state: "conflict" },
          { path: path("new.txt"), status: "added", state: "ready" },
        ],
      },
    ]);
    expect(read("keep.txt")).toBe("changed\n");
  });

  it("reverts the turn on a confirmed POST", async () => {
    insertSession();

    const response = await handleTurnUndoRequest(
      SESSION_ID,
      post({ turn: "prompt-2", confirm: true }),
      dependencies(),
    );

    expect([response.status, await response.json()]).toStrictEqual([
      200,
      { reverted: [path("keep.txt"), path("new.txt")] },
    ]);
    expect(read("keep.txt")).toBe("ONE\ntwo\n");
  });
});
