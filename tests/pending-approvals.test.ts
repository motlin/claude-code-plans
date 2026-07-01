import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import { scanAllPendingApprovals, scanPendingApproval } from "../src/lib/pending-approvals";

function jsonl(...lines: Record<string, unknown>[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

const SESSION_ID = "sess-pending-1";
const PROJECT_DIR_NAME = "-Users-craig-projects-app";

describe("scanPendingApproval", () => {
  const testDir = join(tmpdir(), "claude-pending-approvals-test-" + process.pid);
  let projectsDir: string;
  let projectDir: string;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    projectsDir = join(testDir, "projects");
    projectDir = join(projectsDir, PROJECT_DIR_NAME);
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function writeJsonl(name: string, contents: string): string {
    const path = join(projectDir, name);
    writeFileSync(path, contents);
    return path;
  }

  it("returns an entry for an assistant ExitPlanMode tool_use with no matching tool_result", async () => {
    const filePath = writeJsonl(
      `${SESSION_ID}.jsonl`,
      jsonl(
        {
          type: "user",
          sessionId: SESSION_ID,
          timestamp: "2026-05-14T12:00:00.000Z",
          message: { role: "user", content: "Plan something" },
        },
        {
          type: "assistant",
          sessionId: SESSION_ID,
          timestamp: "2026-05-14T12:00:30.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_abc",
                name: "ExitPlanMode",
                input: {
                  plan: "## Steps\n1. Do thing",
                  planFilePath: "/Users/craig/.claude/plans/alpha.md",
                },
              },
            ],
          },
        },
      ),
    );

    const result = await scanPendingApproval(filePath);

    expect(result).not.toBeNull();
    expect(result!.toolName).toBe("ExitPlanMode");
    expect(result!.toolUseId).toBe("toolu_abc");
    expect(result!.sessionId).toBe(SESSION_ID);
    expect(result!.blockedSince).toBe("2026-05-14T12:00:30.000Z");
    expect(result!.planFilename).toBe("alpha.md");
  });

  it("returns null when a follow-up user tool_result resolves the ExitPlanMode tool_use", async () => {
    const filePath = writeJsonl(
      `${SESSION_ID}.jsonl`,
      jsonl(
        {
          type: "assistant",
          sessionId: SESSION_ID,
          timestamp: "2026-05-14T12:00:30.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_abc",
                name: "ExitPlanMode",
                input: { plan: "## Steps" },
              },
            ],
          },
        },
        {
          type: "user",
          sessionId: SESSION_ID,
          timestamp: "2026-05-14T12:00:45.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_abc",
                content: "User has approved your plan.",
              },
            ],
          },
        },
      ),
    );

    const result = await scanPendingApproval(filePath);

    expect(result).toBeNull();
  });

  it("returns the second ExitPlanMode call when only it is unresolved", async () => {
    const filePath = writeJsonl(
      `${SESSION_ID}.jsonl`,
      jsonl(
        {
          type: "assistant",
          sessionId: SESSION_ID,
          timestamp: "2026-05-14T12:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_first",
                name: "ExitPlanMode",
                input: { plan: "First plan" },
              },
            ],
          },
        },
        {
          type: "user",
          sessionId: SESSION_ID,
          timestamp: "2026-05-14T12:00:05.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_first",
                content: "User has approved your plan.",
              },
            ],
          },
        },
        {
          type: "assistant",
          sessionId: SESSION_ID,
          timestamp: "2026-05-14T12:05:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_second",
                name: "ExitPlanMode",
                input: { plan: "Second plan" },
              },
            ],
          },
        },
      ),
    );

    const result = await scanPendingApproval(filePath);

    expect(result).not.toBeNull();
    expect(result!.toolUseId).toBe("toolu_second");
    expect(result!.toolName).toBe("ExitPlanMode");
    expect(result!.blockedSince).toBe("2026-05-14T12:05:00.000Z");
  });

  it("returns an entry with toolName AskUserQuestion for a blocked AskUserQuestion tool_use", async () => {
    const filePath = writeJsonl(
      `${SESSION_ID}.jsonl`,
      jsonl({
        type: "assistant",
        sessionId: SESSION_ID,
        timestamp: "2026-05-14T12:10:00.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_q",
              name: "AskUserQuestion",
              input: {
                question: "Which database should we use?",
                options: [
                  { label: "SQLite", description: "Local" },
                  { label: "Postgres", description: "Remote" },
                ],
              },
            },
          ],
        },
      }),
    );

    const result = await scanPendingApproval(filePath);

    expect(result).not.toBeNull();
    expect(result!.toolName).toBe("AskUserQuestion");
    expect(result!.toolUseId).toBe("toolu_q");
    expect(result!.questionPreview).toBe("Which database should we use?");
    expect(result!.planFilename).toBeNull();
  });

  it("returns null when the transcript has no blocking tool_use", async () => {
    const filePath = writeJsonl(
      `${SESSION_ID}.jsonl`,
      jsonl(
        {
          type: "user",
          sessionId: SESSION_ID,
          timestamp: "2026-05-14T12:00:00.000Z",
          message: { role: "user", content: "Just a chat message" },
        },
        {
          type: "assistant",
          sessionId: SESSION_ID,
          timestamp: "2026-05-14T12:00:10.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Sure, here is the answer." }],
          },
        },
      ),
    );

    const result = await scanPendingApproval(filePath);

    expect(result).toBeNull();
  });
});

describe("scanAllPendingApprovals", () => {
  const testDir = join(tmpdir(), "claude-pending-all-test-" + process.pid);
  let projectDir: string;
  let db: AppDb;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    projectDir = join(testDir, "projects", PROJECT_DIR_NAME);
    mkdirSync(projectDir, { recursive: true });
    db = openTestDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("skips rows whose session file is missing and returns the valid approval", async () => {
    const validSessionId = "sess-valid";
    const validPath = join(projectDir, `${validSessionId}.jsonl`);
    writeFileSync(
      validPath,
      jsonl({
        type: "assistant",
        sessionId: validSessionId,
        timestamp: "2026-05-14T12:00:30.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_valid",
              name: "ExitPlanMode",
              input: { plan: "## Steps" },
            },
          ],
        },
      }),
    );

    const missingPath = join(projectDir, "sess-missing.jsonl");

    db.index
      .insert(schema.projects)
      .values({ id: "proj-1", name: "app", projectPath: null, updatedAt: 0 })
      .run();
    db.index
      .insert(schema.sessions)
      .values([
        {
          id: "sess-missing",
          projectId: "proj-1",
          title: "Missing",
          messageCount: 0,
          isSidechain: 0,
          createdAt: 0,
          mtimeMs: 0,
          filePath: missingPath,
        },
        {
          id: validSessionId,
          projectId: "proj-1",
          title: "Valid",
          messageCount: 0,
          isSidechain: 0,
          createdAt: 0,
          mtimeMs: 0,
          filePath: validPath,
        },
      ])
      .run();

    const results = await scanAllPendingApprovals(db.index);

    expect(results).toHaveLength(1);
    expect(results[0]!.sessionId).toBe(validSessionId);
    expect(results[0]!.toolUseId).toBe("toolu_valid");
    expect(results[0]!.toolName).toBe("ExitPlanMode");
    expect(results[0]!.projectName).toBe("app");
  });

  function insertBlockingSession(sessionId: string, filePath: string): void {
    writeFileSync(
      filePath,
      jsonl({
        type: "assistant",
        sessionId,
        timestamp: "2026-05-14T12:00:30.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `toolu_${sessionId}`,
              name: "ExitPlanMode",
              input: { plan: "## Steps" },
            },
          ],
        },
      }),
    );
    db.index
      .insert(schema.projects)
      .values({ id: "proj-1", name: "app", projectPath: null, updatedAt: 0 })
      .onConflictDoNothing()
      .run();
    db.index
      .insert(schema.sessions)
      .values({
        id: sessionId,
        projectId: "proj-1",
        title: "Session",
        messageCount: 0,
        isSidechain: 0,
        createdAt: 0,
        mtimeMs: 0,
        filePath,
      })
      .run();
  }

  it("hides a blocking approval whose session file is stale (>7 days)", async () => {
    const sessionId = "sess-stale";
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    insertBlockingSession(sessionId, filePath);

    const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(filePath, eightDaysAgo, eightDaysAgo);

    const results = await scanAllPendingApprovals(db.index);

    expect(results).toEqual([]);
  });

  it("shows a blocking approval whose session file was recently modified", async () => {
    const sessionId = "sess-recent";
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    insertBlockingSession(sessionId, filePath);

    const results = await scanAllPendingApprovals(db.index);

    expect(results).toHaveLength(1);
    expect(results[0]!.sessionId).toBe(sessionId);
    expect(results[0]!.toolName).toBe("ExitPlanMode");
  });
});
