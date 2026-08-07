import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { indexSessionsIndex } from "../src/lib/db/indexer";
import {
  getActiveSessionEntries,
  markSessionActive,
  markSessionEnded,
  setSessionState,
  type ActiveSessionEntry,
} from "../src/lib/active-session-store";
import {
  buildSessionSummaryPayloadFromDb,
  toActiveSessionPayload,
} from "../src/lib/session-summary";
import { initPendingApprovalsCache } from "../src/lib/db/pending-approvals-cache";

const testDir = join(tmpdir(), "claude-session-summary-test-" + process.pid);
const PROJECT_ID = "-tmp-test-alice-project";
const PROJECT_PATH = "/tmp/test/alice-project";
let db: AppDb;

function makeSessionsIndex(entries: Record<string, unknown>[]): string {
  return JSON.stringify({ version: 1, entries });
}

beforeEach(async () => {
  mkdirSync(testDir, { recursive: true });
  db = openTestDb();
  for (const entry of getActiveSessionEntries()) {
    markSessionEnded(entry.sessionId);
  }
  await initPendingApprovalsCache(db.index);
});

afterEach(() => {
  for (const entry of getActiveSessionEntries()) {
    markSessionEnded(entry.sessionId);
  }
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

async function indexSession(transcript = ""): Promise<void> {
  const projectDir = join(testDir, PROJECT_ID);
  mkdirSync(projectDir, { recursive: true });
  const transcriptPath = join(projectDir, "session-test-100.jsonl");
  writeFileSync(transcriptPath, transcript);
  writeFileSync(
    join(projectDir, "sessions-index.json"),
    makeSessionsIndex([
      {
        sessionId: "session-test-100",
        fullPath: transcriptPath,
        fileMtime: 946_598_400_000,
        firstPrompt: "Fix the test login bug",
        summary: "Fixed the test auth issue",
        messageCount: 5,
        projectPath: PROJECT_PATH,
      },
    ]),
  );
  await indexSessionsIndex(db.index, projectDir, PROJECT_ID);
}

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
    await indexSession();

    const payload = buildSessionSummaryPayloadFromDb(db.index, "session-test-100");

    expect(payload).toStrictEqual({
      id: "session-test-100",
      title: "Fixed the test auth issue",
      summary: "Fixed the test auth issue",
      mtime: "1999-12-31T00:00:00.000Z",
      created: "1999-12-31T00:00:00.000Z",
      messageCount: 5,
      project: PROJECT_ID,
      projectName: "alice-project",
      gitBranch: undefined,
      starred: false,
      state: "ended",
      blockedSince: null,
    });
  });

  it("uses the active-session state when no durable approval exists", async () => {
    await indexSession();
    markSessionActive("session-test-100", { cwd: PROJECT_PATH, model: "claude-test-model" });
    setSessionState("session-test-100", "working");

    const payload = buildSessionSummaryPayloadFromDb(db.index, "session-test-100");

    expect(payload).toStrictEqual({
      id: "session-test-100",
      title: "Fixed the test auth issue",
      summary: "Fixed the test auth issue",
      mtime: "1999-12-31T00:00:00.000Z",
      created: "1999-12-31T00:00:00.000Z",
      messageCount: 5,
      project: PROJECT_ID,
      projectName: "alice-project",
      gitBranch: undefined,
      starred: false,
      state: "working",
      blockedSince: null,
    });
  });

  it("prefers a durable pending approval over the active-session state", async () => {
    await indexSession(
      JSON.stringify({
        type: "assistant",
        sessionId: "session-test-100",
        timestamp: "2000-01-01T00:00:00.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-test-100",
              name: "AskUserQuestion",
              input: { question: "Continue the test?" },
            },
          ],
        },
      }) + "\n",
    );
    markSessionActive("session-test-100", { cwd: PROJECT_PATH, model: "claude-test-model" });
    setSessionState("session-test-100", "idle");
    await initPendingApprovalsCache(db.index);

    const payload = buildSessionSummaryPayloadFromDb(db.index, "session-test-100");

    expect(payload).toStrictEqual({
      id: "session-test-100",
      title: "Fixed the test auth issue",
      summary: "Fixed the test auth issue",
      mtime: "1999-12-31T00:00:00.000Z",
      created: "1999-12-31T00:00:00.000Z",
      messageCount: 5,
      project: PROJECT_ID,
      projectName: "alice-project",
      gitBranch: undefined,
      starred: false,
      state: "waiting",
      blockedSince: "2000-01-01T00:00:00.000Z",
    });
  });

  it("returns null when the session id is not in the db", () => {
    const payload = buildSessionSummaryPayloadFromDb(db.index, "does-not-exist");

    expect(payload).toBe(null);
  });
});
