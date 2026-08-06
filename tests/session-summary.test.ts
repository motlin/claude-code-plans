import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { indexSessionsIndex } from "../src/lib/db/indexer";
import {
  buildSessionSummaryPayloadFromDb,
  toActiveSessionPayload,
} from "../src/lib/session-summary";
import type { ActiveSessionEntry } from "../src/lib/active-session-store";

const testDir = join(tmpdir(), "claude-session-summary-test-" + process.pid);
let db: AppDb;

function makeSessionsIndex(entries: Record<string, unknown>[]): string {
  return JSON.stringify({ version: 1, entries });
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe("toActiveSessionPayload", () => {
  it("maps an ActiveSessionEntry into an ActiveSessionPayload 1:1", () => {
    const entry: ActiveSessionEntry = {
      sessionId: "abc-123",
      state: "working",
      cwd: "/home/user/project",
      model: "claude-sonnet-4-6",
      startedAt: 946_598_400_000,
      lastActivity: 946_598_401_000,
      claudeEnv: {},
      tmuxPane: "",
      tmuxServerSocket: "",
      herdrPane: "",
      herdrWorkspace: "",
      herdrSocketPath: "",
    };

    const payload = toActiveSessionPayload(entry);

    expect(payload).toStrictEqual({
      sessionId: "abc-123",
      cwd: "/home/user/project",
      model: "claude-sonnet-4-6",
      startedAt: 946_598_400_000,
      lastActivity: 946_598_401_000,
    });
  });
});

describe("buildSessionSummaryPayloadFromDb", () => {
  it("returns a SessionSummaryPayload for a known session id", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "abc-123",
          fullPath: join(projectDir, "abc-123.jsonl"),
          fileMtime: 946_598_400_000,
          firstPrompt: "Fix the login bug",
          summary: "Fixed auth issue",
          messageCount: 5,
          projectPath: "/Users/craig/projects/app",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    const payload = buildSessionSummaryPayloadFromDb(db.index, "abc-123");

    if (!payload) throw new Error("Expected non-null payload");
    expect(typeof payload.mtime).toBe("string");
    expect(typeof payload.created).toBe("string");
    const { mtime: _mtime, created: _created, ...rest } = payload;
    expect(rest).toStrictEqual({
      id: "abc-123",
      title: "Fixed auth issue",
      summary: "Fixed auth issue",
      messageCount: 5,
      project: "-Users-craig-projects-app",
      projectName: "app",
      gitBranch: undefined,
      starred: false,
    });
  });

  it("returns null when the session id is not in the db", () => {
    const payload = buildSessionSummaryPayloadFromDb(db.index, "does-not-exist");

    expect(payload).toBe(null);
  });
});
