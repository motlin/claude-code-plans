import {
  writeFileSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import {
  fullScan,
  indexFile,
  indexJsonlFile,
  indexSessionsIndex,
  indexTaskFile,
  pruneStalePlanLinks,
  indexSubagentFile,
  linkSubagentParents,
  scanTasksDir,
} from "../src/lib/db/indexer";
import {
  listProjectsFromDb,
  listSessionGroupsFromDb,
  listRecentSessionsFromDb,
  getIndexedSessionIds,
  getSessionTitlesByIds,
  listSessionsForProjectFromDb,
  getPlanLinksFromDb,
  getProjectDetailFromDb,
  searchSessionsFromDb,
  getSubagentById,
  getSubagentsForSession,
  getSubagentsForProject,
  getPlanProjectMappings,
  getSessionProjectPath,
  isSessionStarred,
  toggleStar,
  getStarredSessionIds,
  getStarredSessions,
  searchMessageContentDb,
  getTasksForProject,
  getOpenTasksForProject,
  getIncompleteTasksGroupedByProject,
  getTaskCountsForProject,
  listBranchesForProject,
  listSessionsForBranch,
  listCwdsForProject,
} from "../src/lib/db/queries";
import { ORPHANED_TASKS_PROJECT_ID } from "../src/lib/task-groups";
import * as schema from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { encodeProjectPath } from "../src/lib/memory";

const testDir = join(tmpdir(), "claude-db-test-" + process.pid);
let db: AppDb;

function jsonl(...lines: Record<string, unknown>[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function makeSessionsIndex(entries: Record<string, unknown>[]): string {
  return JSON.stringify({ version: 1, entries });
}

const baseFields = {
  uuid: "uuid-test",
  timestamp: "1999-12-31T00:00:00.000Z",
  sessionId: "sess-1",
  parentUuid: null,
  isSidechain: false,
  userType: "external",
  cwd: "/Users/craig/projects/app",
  gitBranch: "main",
  version: "2.1.71",
  entrypoint: "cli",
};

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe("connection", () => {
  it("creates in-memory databases with schema", () => {
    const row = db.index
      .select()
      .from(schema.metadata)
      .where(eq(schema.metadata.key, "schema_version"))
      .get();
    if (!row) throw new Error("Expected schema_version row");
    expect(row.value).toBe(schema.SCHEMA_VERSION);
  });
});

describe("indexer", () => {
  it("attributes resolved and unresolved symlink paths to the same project", async () => {
    const claudeTarget = join(testDir, "elsewhere");
    const unresolvedClaudeDir = join(testDir, ".claude");
    const unresolvedProjectsDir = join(unresolvedClaudeDir, "projects");
    const projectId = "-tmp-example-project";
    const unresolvedSessionPath = join(unresolvedProjectsDir, projectId, "session-100.jsonl");
    mkdirSync(join(claudeTarget, "projects", projectId), { recursive: true });
    symlinkSync(claudeTarget, unresolvedClaudeDir, "dir");
    writeFileSync(
      unresolvedSessionPath,
      jsonl({
        type: "user",
        ...baseFields,
        uuid: "uuid-100",
        sessionId: "session-100",
        cwd: "/tmp/example-project",
        message: { role: "user", content: "Test symlink indexing" },
      }),
    );

    const indexedSessions: { id: string; projectId: string }[][] = [];
    for (const sessionPath of [realpathSync(unresolvedSessionPath), unresolvedSessionPath]) {
      await indexFile(db.index, sessionPath, unresolvedProjectsDir);
      indexedSessions.push(
        db.index
          .select({ id: schema.sessions.id, projectId: schema.sessions.projectId })
          .from(schema.sessions)
          .all(),
      );
    }

    expect(indexedSessions).toStrictEqual([
      [{ id: "session-100", projectId }],
      [{ id: "session-100", projectId }],
    ]);
  });

  it("indexes sessions-index.json", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "abc-123",
          fullPath: join(projectDir, "abc-123.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Fix the login bug",
          summary: "Fixed auth issue",
          messageCount: 5,
          projectPath: "/Users/craig/projects/app",
        },
        {
          sessionId: "def-456",
          fullPath: join(projectDir, "def-456.jsonl"),
          fileMtime: Date.now() - 60000,
          firstPrompt: "Add tests",
          messageCount: 3,
        },
      ]),
    );

    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    const projects = db.index.select().from(schema.projects).all();
    expect(projects.map((p) => p.name)).toStrictEqual(["app"]);

    const sessions = db.index.select().from(schema.sessions).all();
    expect(sessions.length).toBe(2);

    const abc = sessions.find((s) => s.id === "abc-123");
    if (!abc) throw new Error("Expected session abc-123");
    expect(abc.title).toBe("Fixed auth issue");
    // indexSessionsIndex no longer trusts the sessions-index messageCount;
    // indexJsonlFile owns the canonical count, so a fresh row starts at 0.
    expect(abc.messageCount).toBe(0);
  });

  it("skips unchanged files based on mtime", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "abc-123",
          fullPath: join(projectDir, "abc-123.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Hello",
        },
      ]),
    );

    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");
    const firstRun = db.index.select().from(schema.indexedFiles).all();
    if (firstRun.length !== 1) throw new Error(`Expected 1 indexed file, got ${firstRun.length}`);
    const firstIndexedAt = firstRun[0]!.indexedAt;

    // Re-index without changing the file
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");
    const secondRun = db.index.select().from(schema.indexedFiles).all();
    expect(secondRun[0]?.indexedAt).toBe(firstIndexedAt);
  });

  it("extracts plan links from file-history-snapshot", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    // Create session in DB first (so plan links have a session to reference)
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "sess-1",
          fullPath: join(projectDir, "sess-1.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Work on feature",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    writeFileSync(
      join(projectDir, "sess-1.jsonl"),
      jsonl(
        {
          type: "user",
          ...baseFields,
          message: { role: "user", content: "Work on feature" },
        },
        {
          type: "file-history-snapshot",
          messageId: "msg-1",
          isSnapshotUpdate: false,
          snapshot: {
            messageId: "msg-1",
            timestamp: "1999-12-31T00:00:00.000Z",
            trackedFileBackups: {
              "/Users/craig/.claude/plans/my-plan.md": "backup-content",
            },
          },
        },
      ),
    );

    await indexJsonlFile(db.index, join(projectDir, "sess-1.jsonl"), "-Users-craig-projects-app");

    const links = db.index.select().from(schema.planSessions).all();
    expect(
      links.map((l) => ({
        planFilename: l.planFilename,
        sessionId: l.sessionId,
      })),
    ).toStrictEqual([{ planFilename: "my-plan.md", sessionId: "sess-1" }]);
  });

  it("extracts plan links from plan_mode attachments (before file is edited)", async () => {
    // A session that enters plan mode emits an `attachment` record with
    // `attachment.type === "plan_mode"` and a `planFilePath`. This fires
    // *before* the plan file is ever edited, so it links the session even
    // when no file-history-snapshot trackedFileBackups entry exists.
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "sess-plan-mode",
          fullPath: join(projectDir, "sess-plan-mode.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Draft a plan",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    writeFileSync(
      join(projectDir, "sess-plan-mode.jsonl"),
      jsonl(
        {
          type: "user",
          ...baseFields,
          sessionId: "sess-plan-mode",
          message: { role: "user", content: "Draft a plan" },
        },
        {
          type: "attachment",
          ...baseFields,
          sessionId: "sess-plan-mode",
          attachment: {
            type: "plan_mode",
            reminderType: "full",
            isSubAgent: false,
            planFilePath: "/Users/craig/.claude/plans/abstract-knitting-garden.md",
            planExists: false,
          },
        },
      ),
    );

    await indexJsonlFile(
      db.index,
      join(projectDir, "sess-plan-mode.jsonl"),
      "-Users-craig-projects-app",
    );

    const links = db.index.select().from(schema.planSessions).all();
    expect(
      links.map((l) => ({
        planFilename: l.planFilename,
        sessionId: l.sessionId,
        projectId: l.projectId,
      })),
    ).toStrictEqual([
      {
        planFilename: "abstract-knitting-garden.md",
        sessionId: "sess-plan-mode",
        projectId: "-Users-craig-projects-app",
      },
    ]);
  });

  it("deduplicates plan links when both plan_mode and file-history-snapshot point to the same plan", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "sess-dup",
          fullPath: join(projectDir, "sess-dup.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Draft",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    writeFileSync(
      join(projectDir, "sess-dup.jsonl"),
      jsonl(
        {
          type: "user",
          ...baseFields,
          sessionId: "sess-dup",
          message: { role: "user", content: "Draft" },
        },
        {
          type: "attachment",
          ...baseFields,
          sessionId: "sess-dup",
          attachment: {
            type: "plan_mode",
            planFilePath: "/Users/craig/.claude/plans/dual-plan.md",
          },
        },
        {
          type: "file-history-snapshot",
          messageId: "msg-2",
          isSnapshotUpdate: false,
          snapshot: {
            messageId: "msg-2",
            timestamp: "1999-12-31T00:00:00.000Z",
            trackedFileBackups: {
              "/Users/craig/.claude/plans/dual-plan.md": "backup",
            },
          },
        },
      ),
    );

    await indexJsonlFile(db.index, join(projectDir, "sess-dup.jsonl"), "-Users-craig-projects-app");

    const links = db.index.select().from(schema.planSessions).all();
    expect(links.map((l) => l.planFilename)).toStrictEqual(["dual-plan.md"]);
  });

  it("pruneStalePlanLinks removes plan_sessions rows whose plan file no longer exists", async () => {
    const plansDir = join(testDir, "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "still-here.md"), "# Still Here");

    db.index
      .insert(schema.planSessions)
      .values([
        { planFilename: "still-here.md", sessionId: "s1", projectId: "p1" },
        { planFilename: "gone.md", sessionId: "s1", projectId: "p1" },
        { planFilename: "also-gone.md", sessionId: "s2", projectId: "p1" },
      ])
      .run();

    const removed = await pruneStalePlanLinks(db.index, plansDir);
    expect(removed).toBe(2);

    const remaining = db.index.select().from(schema.planSessions).all();
    expect(remaining.map((r) => r.planFilename)).toStrictEqual(["still-here.md"]);
  });

  it("pruneStalePlanLinks keeps all rows when plans directory is missing", async () => {
    db.index
      .insert(schema.planSessions)
      .values({
        planFilename: "some-plan.md",
        sessionId: "s1",
        projectId: "p1",
      })
      .run();

    const removed = await pruneStalePlanLinks(db.index, join(testDir, "nonexistent-plans-dir"));
    expect(removed).toBe(0);

    const remaining = db.index.select().from(schema.planSessions).all();
    expect(remaining.length).toBe(1);
  });

  it("indexJsonlFile returns linkedPlans matching the filenames upserted into plan_sessions", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "sess-linked",
          fullPath: join(projectDir, "sess-linked.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Draft",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    writeFileSync(
      join(projectDir, "sess-linked.jsonl"),
      jsonl(
        {
          type: "user",
          ...baseFields,
          sessionId: "sess-linked",
          message: { role: "user", content: "Draft" },
        },
        {
          type: "attachment",
          ...baseFields,
          sessionId: "sess-linked",
          attachment: {
            type: "plan_mode",
            planFilePath: "/Users/craig/.claude/plans/alpha.md",
          },
        },
        {
          type: "file-history-snapshot",
          messageId: "msg-3",
          isSnapshotUpdate: false,
          snapshot: {
            messageId: "msg-3",
            timestamp: "1999-12-31T00:00:00.000Z",
            trackedFileBackups: {
              "/Users/craig/.claude/plans/beta.md": "backup",
            },
          },
        },
      ),
    );

    const result = await indexJsonlFile(
      db.index,
      join(projectDir, "sess-linked.jsonl"),
      "-Users-craig-projects-app",
    );

    // Sort both sides — the indexer is free to traverse the Set in any order.
    const returned = [...result.linkedPlans].sort();
    const inDb = db.index
      .select({ planFilename: schema.planSessions.planFilename })
      .from(schema.planSessions)
      .all()
      .map((r) => r.planFilename)
      .sort();
    expect(returned).toStrictEqual(["alpha.md", "beta.md"]);
    expect(returned).toStrictEqual(inDb);
  });

  it("indexJsonlFile returns empty linkedPlans when the JSONL has no plan references", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "sess-no-plans",
          fullPath: join(projectDir, "sess-no-plans.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Nothing",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    writeFileSync(
      join(projectDir, "sess-no-plans.jsonl"),
      jsonl({
        type: "user",
        ...baseFields,
        sessionId: "sess-no-plans",
        message: { role: "user", content: "Hi" },
      }),
    );

    const result = await indexJsonlFile(
      db.index,
      join(projectDir, "sess-no-plans.jsonl"),
      "-Users-craig-projects-app",
    );

    expect(result).toStrictEqual({ linkedPlans: [] });
  });

  it("ignores plan_mode attachments with no planFilePath", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "sess-no-path",
          fullPath: join(projectDir, "sess-no-path.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Draft",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    writeFileSync(
      join(projectDir, "sess-no-path.jsonl"),
      jsonl(
        { type: "user", message: { role: "user", content: "Draft" } },
        {
          type: "attachment",
          attachment: { type: "plan_mode", reminderType: "full" },
        },
      ),
    );

    await indexJsonlFile(
      db.index,
      join(projectDir, "sess-no-path.jsonl"),
      "-Users-craig-projects-app",
    );

    const links = db.index.select().from(schema.planSessions).all();
    expect(links).toStrictEqual([]);
  });

  it("extracts custom-title from JSONL", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "titled-sess",
          fullPath: join(projectDir, "titled-sess.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Do something",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    writeFileSync(
      join(projectDir, "titled-sess.jsonl"),
      jsonl(
        { type: "user", message: { role: "user", content: "Do something" } },
        {
          type: "custom-title",
          customTitle: "My Custom Title",
          sessionId: "titled-sess",
        },
      ),
    );

    await indexJsonlFile(
      db.index,
      join(projectDir, "titled-sess.jsonl"),
      "-Users-craig-projects-app",
    );

    const session = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "titled-sess"))
      .get();
    if (!session) throw new Error("Expected session titled-sess");
    expect(session.customTitle).toBe("My Custom Title");
    expect(session.title).toBe("My Custom Title");
  });

  it("preserves a custom title when sessions-index.json is rewritten", async () => {
    const project = "-Users-alice-projects-example";
    const projectDir = join(testDir, project);
    const sessionId = "session-test-100";
    const sessionPath = join(projectDir, `${sessionId}.jsonl`);
    const indexPath = join(projectDir, "sessions-index.json");
    const initialIndexModifiedAt = new Date("2000-01-01T00:00:00.000Z");
    const rewrittenIndexModifiedAt = new Date("2000-01-02T00:00:00.000Z");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      indexPath,
      makeSessionsIndex([
        {
          sessionId,
          fullPath: sessionPath,
          fileMtime: initialIndexModifiedAt.getTime(),
          firstPrompt: "Original generated title",
        },
      ]),
    );
    utimesSync(indexPath, initialIndexModifiedAt, initialIndexModifiedAt);
    writeFileSync(
      sessionPath,
      jsonl(
        { type: "user", message: { role: "user", content: "Original generated title" } },
        { type: "custom-title", customTitle: "Alice's custom title", sessionId },
      ),
    );

    await indexSessionsIndex(db.index, projectDir, project);
    await indexJsonlFile(db.index, sessionPath, project);

    writeFileSync(
      indexPath,
      makeSessionsIndex([
        {
          sessionId,
          fullPath: sessionPath,
          fileMtime: rewrittenIndexModifiedAt.getTime(),
          firstPrompt: "Original generated title",
          summary: "Updated generated title",
        },
      ]),
    );
    utimesSync(indexPath, rewrittenIndexModifiedAt, rewrittenIndexModifiedAt);
    await indexSessionsIndex(db.index, projectDir, project);

    expect(
      db.index
        .select({ customTitle: schema.sessions.customTitle, title: schema.sessions.title })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .get(),
    ).toStrictEqual({ customTitle: "Alice's custom title", title: "Alice's custom title" });
  });

  it("updates session mtime when JSONL is re-indexed", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    const oldMtime = Date.now() - 86_400_000; // 1 day ago

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "mtime-sess",
          fullPath: join(projectDir, "mtime-sess.jsonl"),
          fileMtime: oldMtime,
          firstPrompt: "Old prompt",
          messageCount: 1,
        },
      ]),
    );

    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    const before = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "mtime-sess"))
      .get();
    if (!before) throw new Error("Expected session mtime-sess");
    expect(before.mtimeMs).toBe(oldMtime);

    // Write JSONL file — its filesystem mtime will be newer than oldMtime
    const jsonlPath = join(projectDir, "mtime-sess.jsonl");
    writeFileSync(
      jsonlPath,
      jsonl({
        type: "user",
        message: { role: "user", content: "New message" },
      }),
    );

    await indexJsonlFile(db.index, jsonlPath, "-Users-craig-projects-app");

    const after = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "mtime-sess"))
      .get();
    if (!after) throw new Error("Expected session mtime-sess after re-index");
    expect(after.mtimeMs).toBeGreaterThan(oldMtime);
  });

  it("persists transcript message counts when the sessions index omits them", async () => {
    const project = "-Users-alice-projects-example";
    const projectDir = join(testDir, project);
    const transcriptPath = join(projectDir, "session-test-100.jsonl");
    const indexPath = join(projectDir, "sessions-index.json");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      indexPath,
      makeSessionsIndex([
        {
          sessionId: "session-test-100",
          fullPath: transcriptPath,
          fileMtime: 946_598_400_000,
          firstPrompt: "Count this prompt",
        },
      ]),
    );
    writeFileSync(
      transcriptPath,
      jsonl(
        {
          type: "user",
          message: { role: "user", content: "Count this prompt" },
        },
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "First response" }] },
        },
        { type: "progress", subtype: "api_req_started" },
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "Second response" }] },
        },
      ),
    );

    await indexSessionsIndex(db.index, projectDir, project);
    await indexJsonlFile(db.index, transcriptPath, project);
    writeFileSync(
      indexPath,
      makeSessionsIndex([
        {
          sessionId: "session-test-100",
          fullPath: transcriptPath,
          fileMtime: 946_598_401_000,
          firstPrompt: "Count this prompt",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, project);

    expect(
      db.index
        .select({ id: schema.sessions.id, messageCount: schema.sessions.messageCount })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, "session-test-100"))
        .get(),
    ).toStrictEqual({ id: "session-test-100", messageCount: 3 });
  });

  it("updates the session location when its JSONL moves to another project", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const oldProject = "-tmp-a";
    const newProject = "-tmp-b";
    const oldProjectDir = join(testDir, oldProject);
    const newProjectDir = join(testDir, newProject);
    const oldFilePath = join(oldProjectDir, `${sessionId}.jsonl`);
    const newFilePath = join(newProjectDir, `${sessionId}.jsonl`);
    mkdirSync(oldProjectDir, { recursive: true });
    mkdirSync(newProjectDir, { recursive: true });
    writeFileSync(
      oldFilePath,
      jsonl({
        type: "user",
        message: { role: "user", content: "Move this test session" },
      }),
    );

    await indexJsonlFile(db.index, oldFilePath, oldProject);
    renameSync(oldFilePath, newFilePath);
    await indexJsonlFile(db.index, newFilePath, newProject);

    const session = db.index
      .select({ filePath: schema.sessions.filePath, projectId: schema.sessions.projectId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    const project = db.index
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, newProject))
      .get();
    expect({ project, session }).toStrictEqual({
      project: { id: newProject },
      session: { filePath: newFilePath, projectId: newProject },
    });
  });

  it("creates session from JSONL when not in index", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "orphan-sess.jsonl"),
      jsonl({
        type: "user",
        message: { role: "user", content: "Hello world" },
      }),
    );

    await indexJsonlFile(
      db.index,
      join(projectDir, "orphan-sess.jsonl"),
      "-Users-craig-projects-app",
    );

    const session = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "orphan-sess"))
      .get();
    if (!session) throw new Error("Expected session orphan-sess");
    expect(session.title).toBe("Hello world");
    expect(session.firstPrompt).toBe("Hello world");
  });

  it("replaces an indexed caveat prompt with the first substantive JSONL prompt", async () => {
    const project = "-Users-alice-projects-example";
    const projectDir = join(testDir, project);
    const sessionPath = join(projectDir, "caveat-session.jsonl");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      sessionPath,
      jsonl(
        {
          type: "user",
          message: {
            role: "user",
            content:
              "<local-command-caveat>Caveat: Fabricated local command context.</local-command-caveat>",
          },
        },
        { type: "user", message: { role: "user", content: "Fix Alice's example session" } },
      ),
    );
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "caveat-session",
          fullPath: sessionPath,
          fileMtime: 946_684_800_000,
          firstPrompt:
            "<local-command-caveat>Caveat: Fabricated local command context.</local-command-caveat>",
        },
      ]),
    );

    await indexSessionsIndex(db.index, projectDir, project);

    const session = db.index
      .select({ title: schema.sessions.title, firstPrompt: schema.sessions.firstPrompt })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "caveat-session"))
      .get();
    expect(session).toStrictEqual({
      title: "Fix Alice's example session",
      firstPrompt: "Fix Alice's example session",
    });
  });

  it("fullScan indexes a complete project directory", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "sess-a",
          fullPath: join(projectDir, "sess-a.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "First session",
          messageCount: 10,
        },
      ]),
    );

    writeFileSync(
      join(projectDir, "sess-a.jsonl"),
      jsonl({
        type: "user",
        message: { role: "user", content: "First session" },
      }),
    );

    writeFileSync(
      join(projectDir, "sess-b.jsonl"),
      jsonl({
        type: "user",
        message: { role: "user", content: "Second session" },
      }),
    );

    await fullScan(db.index, db.summaries, testDir);

    const projects = listProjectsFromDb(db.index);
    expect(projects.map((p) => p.name)).toStrictEqual(["app"]);

    const sessions = db.index.select().from(schema.sessions).all();
    expect(sessions.length).toBe(2);
  });

  it("preserves a resolved project name after its directory is deleted", async () => {
    const sourceProjectPath = join(testDir, "source", "my-project");
    const project = encodeProjectPath(sourceProjectPath);
    const projectDir = join(testDir, project);
    const sessionPath = join(projectDir, "session-alice.jsonl");
    mkdirSync(sourceProjectPath, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "session-alice",
          fullPath: sessionPath,
          fileMtime: 1_000,
          firstPrompt: "Remember the project name",
          projectPath: sourceProjectPath,
        },
      ]),
    );
    writeFileSync(
      sessionPath,
      jsonl({ type: "user", message: { content: "Remember the project name" } }),
    );

    await indexSessionsIndex(db.index, projectDir, project);
    rmSync(sourceProjectPath, { recursive: true });
    await indexJsonlFile(db.index, sessionPath, project);

    const indexedProject = db.index
      .select({ name: schema.projects.name, projectPath: schema.projects.projectPath })
      .from(schema.projects)
      .where(eq(schema.projects.id, project))
      .get();
    expect(indexedProject).toStrictEqual({ name: "my-project", projectPath: null });
  });

  it("repairs a legacy path-like project name when indexed files are unchanged", async () => {
    const project = "-Users-craig-projects-klass-fix-739-rewrite-per-rule";
    const projectDir = join(testDir, project);
    const sessionPath = join(projectDir, "session-alice.jsonl");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      sessionPath,
      jsonl({ type: "user", message: { content: "Repair the display name" } }),
    );

    await fullScan(db.index, db.summaries, testDir);
    db.index
      .update(schema.projects)
      .set({ name: "/Users/craig/projects/klass/fix/739/rewrite/per/rule" })
      .where(eq(schema.projects.id, project))
      .run();

    await fullScan(db.index, db.summaries, testDir);

    const projectNames = listProjectsFromDb(db.index).map((row) => row.name);
    expect(projectNames).toStrictEqual(["rule"]);
    expect(projectNames.every((name) => !name.startsWith("/Users/"))).toBe(true);
  });

  it("derives parent/worktree display names for worktree and nested checkout projects", async () => {
    const repoPath = join(testDir, "repos", "eclipse-collections");
    mkdirSync(repoPath, { recursive: true });
    const parentProject = encodeProjectPath(repoPath);
    const nestedProject = `${parentProject}-merge-4`;
    const worktreeProject = `${parentProject}--claude-worktrees-String-format`;

    for (const [project, prompt] of [
      [parentProject, "parent"],
      [nestedProject, "nested"],
      [worktreeProject, "worktree"],
    ] as const) {
      const projectDir = join(testDir, project);
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        join(projectDir, `sess-${prompt}.jsonl`),
        jsonl({ type: "user", message: { content: prompt } }),
      );
    }
    // Only the parent has a resolved path; the children anchor to its id.
    writeFileSync(
      join(testDir, parentProject, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "sess-parent",
          fullPath: join(testDir, parentProject, "sess-parent.jsonl"),
          fileMtime: 1_000,
          firstPrompt: "parent",
          projectPath: repoPath,
        },
      ]),
    );

    await fullScan(db.index, db.summaries, testDir);

    const names = new Map(
      db.index
        .select({ id: schema.projects.id, name: schema.projects.name })
        .from(schema.projects)
        .all()
        .map((row) => [row.id, row.name]),
    );
    expect([
      names.get(parentProject),
      names.get(nestedProject),
      names.get(worktreeProject),
    ]).toStrictEqual([
      "eclipse-collections",
      "eclipse-collections/merge-4",
      "eclipse-collections/String-format",
    ]);
  });

  it("prunes a session whose primary transcript was deleted", async () => {
    const project = "-tmp-alice-project";
    const projectDir = join(testDir, project);
    const retainedPath = join(projectDir, "session-alice.jsonl");
    const deletedPath = join(projectDir, "session-bob.jsonl");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(retainedPath, jsonl({ type: "user", message: { content: "Retain Alice" } }));
    writeFileSync(deletedPath, jsonl({ type: "user", message: { content: "Delete Bob" } }));

    await fullScan(db.index, db.summaries, testDir);
    rmSync(deletedPath);
    await fullScan(db.index, db.summaries, testDir);

    const sessions = db.index
      .select({ id: schema.sessions.id, filePath: schema.sessions.filePath })
      .from(schema.sessions)
      .all();
    const indexedTranscripts = db.index
      .select({ path: schema.indexedFiles.path })
      .from(schema.indexedFiles)
      .all()
      .filter((row) => row.path.endsWith(".jsonl"));
    expect({ indexedTranscripts, sessions }).toStrictEqual({
      indexedTranscripts: [{ path: retainedPath }],
      sessions: [{ id: "session-alice", filePath: retainedPath }],
    });
  });

  it("preserves metadata when a session transcript moves between projects", async () => {
    const sessionId = "session-alice";
    const oldProject = "-tmp-alice-old";
    const newProject = "-tmp-alice-new";
    const oldProjectDir = join(testDir, oldProject);
    const newProjectDir = join(testDir, newProject);
    const oldPath = join(oldProjectDir, `${sessionId}.jsonl`);
    const newPath = join(newProjectDir, `${sessionId}.jsonl`);
    mkdirSync(oldProjectDir, { recursive: true });
    mkdirSync(newProjectDir, { recursive: true });
    writeFileSync(
      oldPath,
      jsonl({ type: "user", cwd: "/tmp/alice/old", message: { content: "Move Alice" } }),
    );
    await fullScan(db.index, db.summaries, testDir);
    db.index.insert(schema.starredSessions).values({ sessionId, starredAt: 946_684_800_000 }).run();
    db.summaries
      .insert(schema.summaries)
      .values({
        sessionId,
        lastMessageId: "message-alice",
        summary: "Alice moved projects.",
        generatedAt: 946_684_800_000,
      })
      .run();

    renameSync(oldPath, newPath);
    await fullScan(db.index, db.summaries, testDir);

    const session = db.index
      .select({
        id: schema.sessions.id,
        projectId: schema.sessions.projectId,
        filePath: schema.sessions.filePath,
      })
      .from(schema.sessions)
      .get();
    const stars = db.index.select().from(schema.starredSessions).all();
    const summaries = db.summaries.select().from(schema.summaries).all();
    const transcriptPaths = db.index
      .select({ path: schema.indexedFiles.path })
      .from(schema.indexedFiles)
      .all()
      .filter((row) => row.path.endsWith(".jsonl"));
    expect({ session, stars, summaries, transcriptPaths }).toStrictEqual({
      session: { id: sessionId, projectId: newProject, filePath: newPath },
      stars: [{ sessionId, starredAt: 946_684_800_000 }],
      summaries: [
        {
          sessionId,
          lastMessageId: "message-alice",
          summary: "Alice moved projects.",
          generatedAt: 946_684_800_000,
        },
      ],
      transcriptPaths: [{ path: newPath }],
    });
  });

  it("prunes every dependent row for a deleted session", async () => {
    const sessionId = "session-alice";
    const project = "-tmp-alice-project";
    const projectDir = join(testDir, project);
    const sessionPath = join(projectDir, `${sessionId}.jsonl`);
    const subagentsDir = join(projectDir, sessionId, "subagents");
    const subagentPath = join(subagentsDir, "agent-alice.jsonl");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      sessionPath,
      jsonl(
        { type: "user", message: { content: "Ask Alice" } },
        { type: "assistant", message: { content: "Alice answers" } },
      ),
    );
    writeFileSync(
      subagentPath,
      jsonl({
        type: "assistant",
        timestamp: "2000-01-01T00:00:00.000Z",
        message: { content: "Work" },
      }),
    );
    await fullScan(db.index, db.summaries, testDir);
    db.index
      .insert(schema.planSessions)
      .values({ planFilename: "alice-plan.md", sessionId, projectId: project })
      .run();
    db.index.insert(schema.starredSessions).values({ sessionId, starredAt: 946_684_800_000 }).run();
    db.summaries
      .insert(schema.summaries)
      .values({
        sessionId,
        lastMessageId: "message-alice",
        summary: "Alice finished.",
        generatedAt: 946_684_800_000,
      })
      .run();

    rmSync(sessionPath);
    rmSync(join(projectDir, sessionId), { recursive: true });
    await fullScan(db.index, db.summaries, testDir);

    const indexedPaths = db.index
      .select({ path: schema.indexedFiles.path })
      .from(schema.indexedFiles)
      .all();
    const messageContentRows = db.index.all(
      sql`SELECT session_id FROM message_content_fts WHERE session_id = ${sessionId}`,
    );
    const sessionSearchRows = db.index.all(
      sql`SELECT session_id FROM sessions_fts WHERE session_id = ${sessionId}`,
    );
    expect({
      indexedPaths,
      messageContentRows,
      planSessions: db.index.select().from(schema.planSessions).all(),
      sessions: db.index.select().from(schema.sessions).all(),
      sessionSearchRows,
      stars: db.index.select().from(schema.starredSessions).all(),
      subagents: db.index.select().from(schema.subagents).all(),
      summaries: db.summaries.select().from(schema.summaries).all(),
    }).toStrictEqual({
      indexedPaths: [],
      messageContentRows: [],
      planSessions: [],
      sessions: [],
      sessionSearchRows: [],
      stars: [],
      subagents: [],
      summaries: [],
    });
  });

  it("does not prune when a project directory cannot be enumerated", async () => {
    const project = "-tmp-alice-project";
    const projectDir = join(testDir, project);
    const sessionPath = join(projectDir, "session-alice.jsonl");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(sessionPath, jsonl({ type: "user", message: { content: "Retain Alice" } }));
    await fullScan(db.index, db.summaries, testDir);
    rmSync(sessionPath);

    await fullScan(db.index, db.summaries, testDir, undefined, undefined, async (directoryPath) => {
      if (directoryPath === projectDir) throw new Error("Unreadable Alice project fixture");
      return readdir(directoryPath);
    });

    const sessions = db.index
      .select({ id: schema.sessions.id, filePath: schema.sessions.filePath })
      .from(schema.sessions)
      .all();
    const indexedFiles = db.index
      .select({ path: schema.indexedFiles.path })
      .from(schema.indexedFiles)
      .all();
    expect({ indexedFiles, sessions }).toStrictEqual({
      indexedFiles: [{ path: sessionPath }],
      sessions: [{ id: "session-alice", filePath: sessionPath }],
    });
  });

  it("extracts cwd from JSONL attachment lines", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "cwd-sess.jsonl"),
      jsonl(
        { type: "attachment", cwd: "/Users/craig/projects/app" },
        { type: "user", message: { role: "user", content: "Hello from cwd" } },
      ),
    );

    await indexJsonlFile(db.index, join(projectDir, "cwd-sess.jsonl"), "-Users-craig-projects-app");

    const session = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "cwd-sess"))
      .get();
    if (!session) throw new Error("Expected session cwd-sess");
    expect(session.cwd).toBe("/Users/craig/projects/app");
  });

  it("keeps the last cwd anchored to the transcript project after shell directory drift", async () => {
    const project = "-tmp-a";
    const projectDir = join(testDir, project);
    const jsonlPath = join(projectDir, "shell-cd.jsonl");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      jsonlPath,
      jsonl({ type: "attachment", cwd: "/tmp/a" }, { type: "attachment", cwd: "/tmp/a/src" }),
    );

    await indexJsonlFile(db.index, jsonlPath, project);

    const session = db.index
      .select({ cwd: schema.sessions.cwd })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "shell-cd"))
      .get();
    expect(session).toStrictEqual({ cwd: "/tmp/a" });
  });

  it("uses the last cwd anchored to a project after the transcript moves", async () => {
    const project = "-tmp-b";
    const projectDir = join(testDir, project);
    const jsonlPath = join(projectDir, "slash-cd.jsonl");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      jsonlPath,
      jsonl({ type: "attachment", cwd: "/tmp/a" }, { type: "attachment", cwd: "/tmp/b" }),
    );

    await indexJsonlFile(db.index, jsonlPath, project);

    const session = db.index
      .select({ cwd: schema.sessions.cwd })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "slash-cd"))
      .get();
    expect(session).toStrictEqual({ cwd: "/tmp/b" });
  });

  it("falls back to the last cwd when none match the transcript project", async () => {
    const project = "-tmp-c";
    const projectDir = join(testDir, project);
    const jsonlPath = join(projectDir, "unanchored-cwd.jsonl");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      jsonlPath,
      jsonl({ type: "attachment", cwd: "/tmp/a" }, { type: "attachment", cwd: "/tmp/b" }),
    );

    await indexJsonlFile(db.index, jsonlPath, project);

    const session = db.index
      .select({ cwd: schema.sessions.cwd })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "unanchored-cwd"))
      .get();
    expect(session).toStrictEqual({ cwd: "/tmp/b" });
  });

  it("indexes cwd from sessions-index.json projectPath", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "idx-cwd-1",
          fullPath: join(projectDir, "idx-cwd-1.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Hello",
          projectPath: "/Users/craig/projects/app",
        },
      ]),
    );

    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    const session = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "idx-cwd-1"))
      .get();
    if (!session) throw new Error("Expected session idx-cwd-1");
    expect(session.cwd).toBe("/Users/craig/projects/app");
  });

  it("updates cwd when re-indexing JSONL for existing session", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    // Create session via index first (no cwd)
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "update-cwd",
          fullPath: join(projectDir, "update-cwd.jsonl"),
          fileMtime: Date.now() - 1000,
          firstPrompt: "Initial",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    const before = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "update-cwd"))
      .get();
    if (!before) throw new Error("Expected session update-cwd");
    expect(before.cwd).toBe(null);

    // Now write JSONL with cwd
    writeFileSync(
      join(projectDir, "update-cwd.jsonl"),
      jsonl(
        { type: "attachment", cwd: "/Users/craig/projects/app-worktree" },
        { type: "user", message: { role: "user", content: "Updated" } },
      ),
    );

    await indexJsonlFile(
      db.index,
      join(projectDir, "update-cwd.jsonl"),
      "-Users-craig-projects-app",
    );

    const after = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "update-cwd"))
      .get();
    if (!after) throw new Error("Expected session update-cwd after re-index");
    expect(after.cwd).toBe("/Users/craig/projects/app-worktree");
  });

  it("extracts gitBranch from JSONL lines", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "branch-sess.jsonl"),
      jsonl(
        { type: "attachment", gitBranch: "feature-xyz", cwd: "/projects/app" },
        {
          type: "user",
          message: { role: "user", content: "Hello from branch" },
        },
      ),
    );

    await indexJsonlFile(
      db.index,
      join(projectDir, "branch-sess.jsonl"),
      "-Users-craig-projects-app",
    );

    const session = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "branch-sess"))
      .get();
    if (!session) throw new Error("Expected session branch-sess");
    expect(session.gitBranch).toBe("feature-xyz");
  });

  it("updates gitBranch when re-indexing JSONL for existing session", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    // Create session via index first (no gitBranch)
    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "update-branch",
          fullPath: join(projectDir, "update-branch.jsonl"),
          fileMtime: Date.now() - 1000,
          firstPrompt: "Initial",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    const before = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "update-branch"))
      .get();
    if (!before) throw new Error("Expected session update-branch");
    expect(before.gitBranch).toBe(null);

    // Now write JSONL with gitBranch
    writeFileSync(
      join(projectDir, "update-branch.jsonl"),
      jsonl(
        { type: "attachment", gitBranch: "main" },
        { type: "user", message: { role: "user", content: "Updated" } },
      ),
    );

    await indexJsonlFile(
      db.index,
      join(projectDir, "update-branch.jsonl"),
      "-Users-craig-projects-app",
    );

    const after = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "update-branch"))
      .get();
    if (!after) throw new Error("Expected session update-branch after re-index");
    expect(after.gitBranch).toBe("main");
  });

  it("normalizes detached-HEAD gitBranch to null when indexing JSONL", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "detached-sess.jsonl"),
      jsonl(
        { type: "attachment", gitBranch: "HEAD", cwd: "/projects/app" },
        {
          type: "user",
          message: { role: "user", content: "Hello from detached HEAD" },
        },
      ),
    );

    await indexJsonlFile(
      db.index,
      join(projectDir, "detached-sess.jsonl"),
      "-Users-craig-projects-app",
    );

    const session = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "detached-sess"))
      .get();
    if (!session) throw new Error("Expected session detached-sess");
    expect(session.gitBranch).toBe(null);
  });

  it("prefers a later real branch over an earlier detached-HEAD line in JSONL", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "reattached-sess.jsonl"),
      jsonl(
        { type: "attachment", gitBranch: "HEAD", cwd: "/projects/app" },
        { type: "attachment", gitBranch: "feature-abc", cwd: "/projects/app" },
        {
          type: "user",
          message: { role: "user", content: "Back on a branch" },
        },
      ),
    );

    await indexJsonlFile(
      db.index,
      join(projectDir, "reattached-sess.jsonl"),
      "-Users-craig-projects-app",
    );

    const session = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "reattached-sess"))
      .get();
    if (!session) throw new Error("Expected session reattached-sess");
    expect(session.gitBranch).toBe("feature-abc");
  });

  it("normalizes detached-HEAD gitBranch to null when indexing sessions-index", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "detached-index-sess",
          fullPath: join(projectDir, "detached-index-sess.jsonl"),
          fileMtime: Date.now() - 1000,
          firstPrompt: "Initial",
          gitBranch: "HEAD",
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    const session = db.index
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "detached-index-sess"))
      .get();
    if (!session) throw new Error("Expected session detached-index-sess");
    expect(session.gitBranch).toBe(null);
  });
});

describe("queries", () => {
  beforeEach(() => {
    // Seed test data directly
    db.index
      .insert(schema.projects)
      .values([
        {
          id: "proj-a",
          name: "Alpha",
          projectPath: "/projects/alpha",
          updatedAt: 2000,
        },
        {
          id: "proj-b",
          name: "Beta",
          projectPath: "/projects/beta",
          updatedAt: 1000,
        },
      ])
      .run();

    db.index
      .insert(schema.sessions)
      .values([
        {
          id: "sess-1",
          projectId: "proj-a",
          title: "Fix login",
          firstPrompt: "Fix the login bug",
          summary: "Fixed auth",
          messageCount: 5,
          isSidechain: 0,
          createdAt: 1000,
          mtimeMs: 3000,
          filePath: "/path/sess-1.jsonl",
        },
        {
          id: "sess-2",
          projectId: "proj-a",
          title: "Add tests",
          firstPrompt: "Add unit tests",
          messageCount: 3,
          isSidechain: 0,
          createdAt: 500,
          mtimeMs: 2000,
          filePath: "/path/sess-2.jsonl",
        },
        {
          id: "sess-3",
          projectId: "proj-b",
          title: "Deploy",
          firstPrompt: "Deploy to prod",
          messageCount: 2,
          isSidechain: 0,
          createdAt: 800,
          mtimeMs: 1500,
          filePath: "/path/sess-3.jsonl",
        },
        {
          id: "sess-side",
          projectId: "proj-a",
          title: "Sidechain",
          messageCount: 1,
          isSidechain: 1,
          createdAt: 900,
          mtimeMs: 2500,
          filePath: "/path/sess-side.jsonl",
        },
      ])
      .run();

    db.index
      .insert(schema.planSessions)
      .values([
        { planFilename: "plan-a.md", sessionId: "sess-1", projectId: "proj-a" },
        { planFilename: "plan-a.md", sessionId: "sess-2", projectId: "proj-a" },
      ])
      .run();
  });

  it("listProjectsFromDb returns projects sorted by last activity", () => {
    const projects = listProjectsFromDb(db.index);
    expect(projects.map((p) => p.id)).toStrictEqual(["proj-a", "proj-b"]);
    expect(projects[0]!.sessionCount).toBe(2); // excludes sidechain
  });

  it("listSessionGroupsFromDb returns grouped sessions excluding sidechains, with counts", () => {
    const groups = listSessionGroupsFromDb(db.index);
    expect(groups.map((g) => g.project)).toStrictEqual(["proj-a", "proj-b"]);
    expect(groups[0]!.sessions.map((s) => s.id)).toStrictEqual(["sess-1", "sess-2"]); // no sidechain, highest mtime first
    expect(groups[0]!.sessionCount).toBe(2);
    expect(groups[1]!.sessionCount).toBe(1);
  });

  it("listSessionGroupsFromDb caps sessions per project but keeps full count", () => {
    const groups = listSessionGroupsFromDb(db.index, { perProject: 1 });
    const alpha = groups.find((g) => g.project === "proj-a")!;
    expect(alpha.sessions.map((s) => s.id)).toStrictEqual(["sess-1"]); // only newest
    expect(alpha.sessionCount).toBe(2); // count still reflects all non-sidechain sessions
  });

  it("listRecentSessionsFromDb returns a flat mtime-desc page across projects", () => {
    const page = listRecentSessionsFromDb(db.index, { limit: 10 });
    expect(page.sessions.map((s) => s.id)).toStrictEqual(["sess-1", "sess-2", "sess-3"]); // sidechain excluded
    expect(page.nextCursor).toBe(null);
  });

  it("listRecentSessionsFromDb paginates via the cursor without gaps or overlaps", () => {
    const first = listRecentSessionsFromDb(db.index, { limit: 2 });
    expect(first.sessions.map((s) => s.id)).toStrictEqual(["sess-1", "sess-2"]);
    expect(first.nextCursor).toStrictEqual({ mtimeMs: 2000, id: "sess-2" });

    const second = listRecentSessionsFromDb(db.index, { limit: 2, before: first.nextCursor! });
    expect(second.sessions.map((s) => s.id)).toStrictEqual(["sess-3"]);
    expect(second.nextCursor).toBe(null);
  });

  it("getSessionTitlesByIds returns a map of id to title for known sessions", () => {
    expect(getSessionTitlesByIds(db.index, ["sess-1", "sess-3", "missing"])).toStrictEqual({
      "sess-1": "Fix login",
      "sess-3": "Deploy",
    });
  });

  it("getIndexedSessionIds returns only ids for indexed sessions", () => {
    expect(getIndexedSessionIds(db.index, ["sess-1", "sess-3"])).toStrictEqual(
      new Set(["sess-1", "sess-3"]),
    );
    expect(getIndexedSessionIds(db.index, ["missing-a", "missing-b"])).toStrictEqual(new Set());
    expect(getIndexedSessionIds(db.index, ["sess-2", "missing"])).toStrictEqual(
      new Set(["sess-2"]),
    );
    expect(getIndexedSessionIds(db.index, [])).toStrictEqual(new Set());
  });

  it("listSessionsForProjectFromDb returns sessions for a project", () => {
    const sessions = listSessionsForProjectFromDb(db.index, "proj-a");
    expect(sessions.map((s) => s.id)).toStrictEqual(["sess-1", "sess-2"]);
  });

  it("getPlanLinksFromDb returns links for a plan with session titles", () => {
    const links = getPlanLinksFromDb(db.index, "plan-a.md");
    expect(
      links.map((l) => ({
        projectName: l.projectName,
        sessionTitle: l.sessionTitle,
      })),
    ).toStrictEqual([
      { projectName: "Alpha", sessionTitle: "Fix login" },
      { projectName: "Alpha", sessionTitle: "Add tests" },
    ]);
  });

  it("getPlanLinksFromDb returns all links when no filename given", () => {
    const links = getPlanLinksFromDb(db.index);
    expect(links.length).toBe(2);
  });

  it("getProjectDetailFromDb returns project with sessions and plan links", () => {
    const detail = getProjectDetailFromDb(db.index, "proj-a");
    if (!detail) throw new Error("Expected project detail for proj-a");
    expect(detail.name).toBe("Alpha");
    expect(detail.sessions.length).toBe(2);
    expect(detail.planLinks.length).toBe(2);
  });

  it("getProjectDetailFromDb returns null for non-existent project", () => {
    expect(getProjectDetailFromDb(db.index, "nonexistent")).toBe(null);
  });

  it("getPlanProjectMappings returns distinct plan-to-project mappings", () => {
    const mappings = getPlanProjectMappings(db.index);
    // plan-a.md -> proj-a (deduplicated)
    expect(
      mappings.map((m) => ({
        planFilename: m.planFilename,
        projectId: m.projectId,
        projectName: m.projectName,
      })),
    ).toStrictEqual([{ planFilename: "plan-a.md", projectId: "proj-a", projectName: "Alpha" }]);
  });

  it("getPlanProjectMappings returns mappings across multiple projects", () => {
    db.index
      .insert(schema.planSessions)
      .values({
        planFilename: "plan-b.md",
        sessionId: "sess-3",
        projectId: "proj-b",
      })
      .run();

    const mappings = getPlanProjectMappings(db.index);
    expect(mappings.length).toBe(2);
    const filenames = mappings.map((m) => m.planFilename).sort();
    expect(filenames).toStrictEqual(["plan-a.md", "plan-b.md"]);
  });

  it("searchSessionsFromDb finds sessions by title", () => {
    const results = searchSessionsFromDb(db.index, "login");
    if (results.length === 0) throw new Error("Expected at least one result");
    expect(results[0]!.sessionId).toBe("sess-1");
  });

  it("searchSessionsFromDb finds sessions by first prompt", () => {
    const results = searchSessionsFromDb(db.index, "unit tests");
    if (results.length === 0) throw new Error("Expected at least one result");
    expect(results[0]!.sessionId).toBe("sess-2");
  });

  it.each(['foo"bar', "a AND"])(
    "searchSessionsFromDb returns no results for malformed query %s",
    (query) => {
      expect(searchSessionsFromDb(db.index, query)).toStrictEqual([]);
    },
  );

  it("escapes HTML in session search snippets while preserving highlights", () => {
    db.index
      .update(schema.sessions)
      .set({ title: "login <script>alert(1)</script>" })
      .where(eq(schema.sessions.id, "sess-1"))
      .run();

    const result = searchSessionsFromDb(db.index, "login")[0];
    if (!result) throw new Error("Expected a session search result");
    expect(result.titleHtml).toBe("<mark>login</mark> &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.snippet).toBe("Fix the <mark>login</mark> bug");
  });

  it("highlights the title and suppresses a snippet that only echoes the title prefix", () => {
    db.index
      .insert(schema.sessions)
      .values({
        id: "sess-echo",
        projectId: "proj-a",
        title: "release notes say SessionStart hooks can now...",
        firstPrompt: "release notes say SessionStart hooks can now return context",
        messageCount: 4,
        isSidechain: 0,
        createdAt: 1200,
        mtimeMs: 2600,
        filePath: "/path/sess-echo.jsonl",
      })
      .run();

    const result = searchSessionsFromDb(db.index, "hooks").find((r) => r.sessionId === "sess-echo");
    if (!result) throw new Error("Expected a session search result for sess-echo");
    expect(result.titleHtml).toBe("release notes say SessionStart <mark>hooks</mark> can now...");
    expect(result.snippet).toBe("");
  });

  it("keeps a highlighted excerpt that extends beyond the title echo", () => {
    db.index
      .insert(schema.sessions)
      .values({
        id: "sess-tail",
        projectId: "proj-a",
        title: "release notes say SessionStart hooks can now...",
        firstPrompt: "release notes say SessionStart hooks can now return widget context",
        messageCount: 4,
        isSidechain: 0,
        createdAt: 1300,
        mtimeMs: 2700,
        filePath: "/path/sess-tail.jsonl",
      })
      .run();

    const result = searchSessionsFromDb(db.index, "widget").find(
      (r) => r.sessionId === "sess-tail",
    );
    if (!result) throw new Error("Expected a session search result for sess-tail");
    expect(result.titleHtml).toBe("release notes say SessionStart hooks can now...");
    expect(result.snippet).toBe("...return <mark>widget</mark> context");
  });

  it("shows a highlighted summary snippet when only the summary matches", () => {
    const result = searchSessionsFromDb(db.index, "auth").find((r) => r.sessionId === "sess-1");
    if (!result) throw new Error("Expected a session search result for sess-1");
    expect(result.titleHtml).toBe("Fix login");
    expect(result.snippet).toBe("Fixed <mark>auth</mark>");
  });

  it("getSessionProjectPath returns project path for a session", () => {
    const path = getSessionProjectPath(db.index, "sess-1");
    expect(path).toBe("/projects/alpha");
  });

  it("getSessionProjectPath returns null for non-existent session", () => {
    const path = getSessionProjectPath(db.index, "nonexistent");
    expect(path).toBe(null);
  });

  it("getSessionProjectPath returns project path for session in different project", () => {
    const path = getSessionProjectPath(db.index, "sess-3");
    expect(path).toBe("/projects/beta");
  });
});

describe("branch and cwd queries", () => {
  beforeEach(() => {
    db.index
      .insert(schema.projects)
      .values([
        {
          id: "proj-a",
          name: "Alpha",
          projectPath: "/projects/alpha",
          updatedAt: 2000,
        },
      ])
      .run();

    db.index
      .insert(schema.sessions)
      .values([
        {
          id: "b-sess-1",
          projectId: "proj-a",
          title: "Feature work",
          messageCount: 5,
          gitBranch: "feature-x",
          cwd: "/projects/alpha",
          isSidechain: 0,
          createdAt: 1000,
          mtimeMs: 3000,
          filePath: "/path/b-sess-1.jsonl",
        },
        {
          id: "b-sess-2",
          projectId: "proj-a",
          title: "More feature work",
          messageCount: 3,
          gitBranch: "feature-x",
          cwd: "/projects/alpha",
          isSidechain: 0,
          createdAt: 500,
          mtimeMs: 2000,
          filePath: "/path/b-sess-2.jsonl",
        },
        {
          id: "b-sess-3",
          projectId: "proj-a",
          title: "Main work",
          messageCount: 2,
          gitBranch: "main",
          cwd: "/projects/alpha-worktree",
          isSidechain: 0,
          createdAt: 800,
          mtimeMs: 1500,
          filePath: "/path/b-sess-3.jsonl",
        },
        {
          id: "b-sess-4",
          projectId: "proj-a",
          title: "No branch",
          messageCount: 1,
          isSidechain: 0,
          createdAt: 700,
          mtimeMs: 1000,
          filePath: "/path/b-sess-4.jsonl",
        },
        {
          id: "b-sess-side",
          projectId: "proj-a",
          title: "Sidechain",
          messageCount: 1,
          gitBranch: "feature-x",
          isSidechain: 1,
          createdAt: 900,
          mtimeMs: 2500,
          filePath: "/path/b-sess-side.jsonl",
        },
      ])
      .run();
  });

  it("listBranchesForProject returns branches sorted by last activity", () => {
    const branches = listBranchesForProject(db.index, "proj-a");
    expect(branches.map((b) => ({ branch: b.branch, sessionCount: b.sessionCount }))).toStrictEqual(
      [
        { branch: "feature-x", sessionCount: 2 },
        { branch: "main", sessionCount: 1 },
      ],
    );
  });

  it("listBranchesForProject excludes sidechains", () => {
    const branches = listBranchesForProject(db.index, "proj-a");
    const featureX = branches.find((b) => b.branch === "feature-x");
    if (!featureX) throw new Error("Expected feature-x branch");
    expect(featureX.sessionCount).toBe(2);
  });

  it("listSessionsForBranch returns sessions for a specific branch", () => {
    const sessions = listSessionsForBranch(db.index, "proj-a", "feature-x");
    expect(sessions.map((s) => s.id)).toStrictEqual(["b-sess-1", "b-sess-2"]);
  });

  it("listSessionsForBranch returns empty for non-existent branch", () => {
    const sessions = listSessionsForBranch(db.index, "proj-a", "nonexistent");
    expect(sessions).toStrictEqual([]);
  });

  it("listCwdsForProject returns unique cwds sorted by last activity", () => {
    const cwds = listCwdsForProject(db.index, "proj-a");
    expect(cwds.map((c) => ({ cwd: c.cwd, sessionCount: c.sessionCount }))).toStrictEqual([
      { cwd: "/projects/alpha", sessionCount: 2 },
      { cwd: "/projects/alpha-worktree", sessionCount: 1 },
    ]);
  });
});

describe("subagents", () => {
  it("getSubagentsForSession returns subagents", () => {
    db.index.insert(schema.projects).values({ id: "proj-x", name: "X", updatedAt: 1000 }).run();
    db.index
      .insert(schema.subagents)
      .values([
        {
          id: "agent-abc",
          sessionId: "sess-x",
          projectId: "proj-x",
          agentType: "Explore",
          slug: "explore files",
          filePath: "/path/agent-abc.jsonl",
          mtimeMs: 1000,
        },
        {
          id: "agent-def",
          sessionId: "sess-x",
          projectId: "proj-x",
          agentType: null,
          slug: null,
          filePath: "/path/agent-def.jsonl",
          mtimeMs: 2000,
        },
      ])
      .run();

    const agents = getSubagentsForSession(db.index, "sess-x");
    expect(agents.length).toBe(2);
    expect(agents[0]!.agentType).toBe("Explore");
  });

  it("getSubagentsForProject returns subagents across all sessions in the project", () => {
    db.index.insert(schema.projects).values({ id: "proj-y", name: "Y", updatedAt: 1000 }).run();
    db.index
      .insert(schema.subagents)
      .values([
        {
          id: "agent-1",
          sessionId: "sess-1",
          projectId: "proj-y",
          agentType: "Explore",
          slug: null,
          filePath: "/path/agent-1.jsonl",
          mtimeMs: 1000,
        },
        {
          id: "agent-2",
          sessionId: "sess-2",
          projectId: "proj-y",
          agentType: "Plan",
          slug: null,
          filePath: "/path/agent-2.jsonl",
          mtimeMs: 2000,
        },
        {
          id: "agent-3",
          sessionId: "sess-3",
          projectId: "proj-other",
          agentType: "Explore",
          slug: null,
          filePath: "/path/agent-3.jsonl",
          mtimeMs: 3000,
        },
      ])
      .run();

    const agents = getSubagentsForProject(db.index, "proj-y");
    expect(agents.length).toBe(2);
    expect(agents.map((a) => a.id).sort()).toStrictEqual(["agent-1", "agent-2"]);
  });

  it("getSubagentsForProject returns empty array when project has no subagents", () => {
    expect(getSubagentsForProject(db.index, "nonexistent-project")).toStrictEqual([]);
  });

  it("returns empty array for session with no subagents", () => {
    expect(getSubagentsForSession(db.index, "nonexistent")).toStrictEqual([]);
  });

  it("getSubagentById returns the subagent matching the given ID", () => {
    db.index
      .insert(schema.projects)
      .values({ id: "proj-lookup", name: "Lookup", updatedAt: 1000 })
      .run();
    db.index
      .insert(schema.subagents)
      .values({
        id: "agent-lookup-1",
        sessionId: "sess-lookup",
        projectId: "proj-lookup",
        agentType: "Explore",
        slug: "explore-slug",
        description: "Explore files",
        filePath: "/path/agent-lookup-1.jsonl",
        mtimeMs: 1000,
      })
      .run();

    const found = getSubagentById(db.index, "agent-lookup-1");
    expect(found).toBeDefined();
    expect(found!.id).toBe("agent-lookup-1");
    expect(found!.sessionId).toBe("sess-lookup");
    expect(found!.description).toBe("Explore files");
  });

  it("getSubagentById returns undefined for a nonexistent agent", () => {
    expect(getSubagentById(db.index, "agent-nonexistent")).toBeUndefined();
  });

  it("indexSubagentFile extracts startedAt and finishedAt from JSONL timestamps", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    const sessionDir = join(projectDir, "sess-1", "subagents");
    mkdirSync(sessionDir, { recursive: true });

    const agentPath = join(sessionDir, "agent-abc123.jsonl");
    writeFileSync(
      agentPath,
      jsonl(
        {
          type: "user",
          slug: "explore-stuff",
          timestamp: "1999-12-31T00:28:53.989Z",
          message: { role: "user", content: "Do something" },
        },
        {
          type: "assistant",
          timestamp: "1999-12-31T00:29:05.000Z",
          message: { role: "assistant", content: "Working on it" },
        },
        {
          type: "assistant",
          timestamp: "1999-12-31T00:29:12.217Z",
          message: { role: "assistant", content: "Done" },
        },
      ),
    );

    db.index.insert(schema.projects).values({ id: "proj-app", name: "App", updatedAt: 1000 }).run();
    await indexSubagentFile(db.index, agentPath, "sess-1", "proj-app");

    const agent = db.index
      .select()
      .from(schema.subagents)
      .where(eq(schema.subagents.id, "agent-abc123"))
      .get();
    if (!agent) throw new Error("Expected subagent agent-abc123");
    expect(agent.startedAt).toBe("1999-12-31T00:28:53.989Z");
    expect(agent.finishedAt).toBe("1999-12-31T00:29:12.217Z");
  });

  it("indexSubagentFile preserves transcript attribution beside sibling metadata", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    const sessionDir = join(projectDir, "sess-1", "subagents");
    mkdirSync(sessionDir, { recursive: true });

    const agentPath = join(sessionDir, "agent-meta1.jsonl");
    writeFileSync(
      agentPath,
      jsonl({
        type: "user",
        attributionAgent: "markdown-tasks:do-task",
        slug: "lemur-1",
        timestamp: "1999-12-31T00:28:53.000Z",
        message: { role: "user", content: "go" },
      }),
    );
    writeFileSync(
      agentPath.replace(/\.jsonl$/, ".meta.json"),
      JSON.stringify({
        agentType: "Explore",
        description: "Map current render pipeline",
      }),
    );

    db.index.insert(schema.projects).values({ id: "proj-app", name: "App", updatedAt: 1000 }).run();
    await indexSubagentFile(db.index, agentPath, "sess-1", "proj-app");

    const agent = db.index
      .select()
      .from(schema.subagents)
      .where(eq(schema.subagents.id, "agent-meta1"))
      .get();
    if (!agent) throw new Error("Expected subagent agent-meta1");
    expect(agent.agentType).toBe("Explore");
    expect(agent.attributionAgent).toBe("markdown-tasks:do-task");
    expect(agent.description).toBe("Map current render pipeline");
  });

  it("uses transcript attribution as the agent type when metadata is absent", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    const sessionDir = join(projectDir, "sess-1", "subagents");
    mkdirSync(sessionDir, { recursive: true });

    const agentPath = join(sessionDir, "agent-attributed.jsonl");
    writeFileSync(
      agentPath,
      jsonl({
        type: "assistant",
        attributionAgent: "workflow-subagent",
        timestamp: "1999-12-31T00:28:53.000Z",
        message: { role: "assistant", content: "go" },
      }),
    );

    db.index.insert(schema.projects).values({ id: "proj-app", name: "App", updatedAt: 1000 }).run();
    await indexSubagentFile(db.index, agentPath, "sess-1", "proj-app");

    const agent = db.index
      .select()
      .from(schema.subagents)
      .where(eq(schema.subagents.id, "agent-attributed"))
      .get();
    if (!agent) throw new Error("Expected subagent agent-attributed");
    expect({ agentType: agent.agentType, attributionAgent: agent.attributionAgent }).toStrictEqual({
      agentType: "workflow-subagent",
      attributionAgent: "workflow-subagent",
    });
  });

  it("updates the stored location when a subagent transcript moves projects", async () => {
    const originalDirectory = join(testDir, "project-alice", "session-test-100", "subagents");
    const movedDirectory = join(testDir, "project-bob", "session-test-100", "subagents");
    mkdirSync(originalDirectory, { recursive: true });
    mkdirSync(movedDirectory, { recursive: true });
    const originalPath = join(originalDirectory, "agent-test-100.jsonl");
    const movedPath = join(movedDirectory, "agent-test-100.jsonl");
    writeFileSync(
      originalPath,
      jsonl({
        type: "assistant",
        timestamp: "2000-01-01T00:00:00.000Z",
        message: { role: "assistant", content: "Alice fixture output" },
      }),
    );

    await indexSubagentFile(db.index, originalPath, "session-test-100", "project-alice");
    renameSync(originalPath, movedPath);
    await indexSubagentFile(db.index, movedPath, "session-test-100", "project-bob");

    expect(
      db.index
        .select({ filePath: schema.subagents.filePath, projectId: schema.subagents.projectId })
        .from(schema.subagents)
        .where(eq(schema.subagents.id, "agent-test-100"))
        .get(),
    ).toStrictEqual({ filePath: movedPath, projectId: "project-bob" });
  });

  it("linkSubagentParents sets parentAgentId from Agent tool calls in parent JSONL", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    // Create parent session JSONL with Agent tool calls
    const parentJsonl = join(projectDir, "sess-1.jsonl");
    writeFileSync(
      parentJsonl,
      jsonl(
        { type: "user", message: { role: "user", content: "Do work" } },
        {
          type: "assistant",
          timestamp: "1999-12-31T00:10:00.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Let me spawn some agents" },
              {
                type: "tool_use",
                id: "tool-1",
                name: "Agent",
                input: {
                  prompt: "explore",
                  subagent_type: "Explore",
                  description: "Search codebase",
                },
              },
              {
                type: "tool_use",
                id: "tool-2",
                name: "Agent",
                input: {
                  prompt: "review code",
                  subagent_type: "general-purpose",
                  description: "Code review",
                },
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "agentId: abc123\nFound files",
              },
              {
                type: "tool_result",
                tool_use_id: "tool-2",
                content: "agentId: def456\nReview complete",
              },
            ],
          },
        },
      ),
    );

    // Insert subagent rows (as if indexSubagentFile already ran)
    db.index.insert(schema.projects).values({ id: "proj-app", name: "App", updatedAt: 1000 }).run();
    db.index
      .insert(schema.subagents)
      .values([
        {
          id: "agent-abc123",
          sessionId: "sess-1",
          projectId: "proj-app",
          filePath: "/path/agent-abc123.jsonl",
          mtimeMs: 1000,
        },
        {
          id: "agent-def456",
          sessionId: "sess-1",
          projectId: "proj-app",
          filePath: "/path/agent-def456.jsonl",
          mtimeMs: 1000,
        },
        {
          id: "agent-other",
          sessionId: "sess-1",
          projectId: "proj-app",
          filePath: "/path/agent-other.jsonl",
          mtimeMs: 1000,
        },
      ])
      .run();

    await linkSubagentParents(db.index, parentJsonl, null);

    const abc = db.index
      .select()
      .from(schema.subagents)
      .where(eq(schema.subagents.id, "agent-abc123"))
      .get();
    if (!abc) throw new Error("Expected subagent agent-abc123");
    expect(abc.parentAgentId).toBe(null); // root-spawned -> null
    expect(abc.description).toBe("Search codebase");

    const def = db.index
      .select()
      .from(schema.subagents)
      .where(eq(schema.subagents.id, "agent-def456"))
      .get();
    if (!def) throw new Error("Expected subagent agent-def456");
    expect(def.parentAgentId).toBe(null); // root-spawned -> null
    expect(def.description).toBe("Code review");

    const other = db.index
      .select()
      .from(schema.subagents)
      .where(eq(schema.subagents.id, "agent-other"))
      .get();
    if (!other) throw new Error("Expected subagent agent-other");
    expect(other.parentAgentId).toBe(null); // not mentioned in JSONL, stays null
  });

  it("linkSubagentParents sets parentAgentId for nested subagents", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    // Create a subagent JSONL that spawns another subagent
    const parentAgentJsonl = join(projectDir, "agent-parent111.jsonl");
    writeFileSync(
      parentAgentJsonl,
      jsonl(
        {
          type: "user",
          message: { role: "user", content: "Research something" },
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-nested",
                name: "Agent",
                input: { prompt: "deep scan", subagent_type: "Explore" },
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-nested",
                content: "agentId: child222\nResults",
              },
            ],
          },
        },
      ),
    );

    db.index.insert(schema.projects).values({ id: "proj-app", name: "App", updatedAt: 1000 }).run();
    db.index
      .insert(schema.subagents)
      .values([
        {
          id: "agent-parent111",
          sessionId: "sess-1",
          projectId: "proj-app",
          filePath: parentAgentJsonl,
          mtimeMs: 1000,
        },
        {
          id: "agent-child222",
          sessionId: "sess-1",
          projectId: "proj-app",
          filePath: "/path/agent-child222.jsonl",
          mtimeMs: 1000,
        },
      ])
      .run();

    await linkSubagentParents(db.index, parentAgentJsonl, "agent-parent111");

    const child = db.index
      .select()
      .from(schema.subagents)
      .where(eq(schema.subagents.id, "agent-child222"))
      .get();
    if (!child) throw new Error("Expected subagent agent-child222");
    expect(child.parentAgentId).toBe("agent-parent111");
  });

  it("linkSubagentParents does not overwrite existing parentAgentId with null", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    // Root session JSONL that also mentions agent-child222 (e.g. via acompact replay)
    const rootJsonl = join(projectDir, "sess-1.jsonl");
    writeFileSync(
      rootJsonl,
      jsonl(
        { type: "user", message: { role: "user", content: "Do work" } },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-root",
                name: "Agent",
                input: { prompt: "scan", description: "Root agent call" },
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-root",
                content: "agentId: child222\nDone",
              },
            ],
          },
        },
      ),
    );

    db.index.insert(schema.projects).values({ id: "proj-app", name: "App", updatedAt: 1000 }).run();
    db.index
      .insert(schema.subagents)
      .values([
        {
          id: "agent-child222",
          sessionId: "sess-1",
          projectId: "proj-app",
          parentAgentId: "agent-parent111",
          filePath: "/path/agent-child222.jsonl",
          mtimeMs: 1000,
        },
      ])
      .run();

    // Root pass with parentAgentId=null should NOT overwrite the existing parent
    await linkSubagentParents(db.index, rootJsonl, null);

    const child = db.index
      .select()
      .from(schema.subagents)
      .where(eq(schema.subagents.id, "agent-child222"))
      .get();
    if (!child) throw new Error("Expected subagent agent-child222");
    expect(child.parentAgentId).toBe("agent-parent111");
    // Description should still be updated even when parentAgentId is preserved
    expect(child.description).toBe("Root agent call");
  });
});

describe("starred sessions", () => {
  beforeEach(() => {
    db.index
      .insert(schema.projects)
      .values({
        id: "proj-a",
        name: "Alpha",
        projectPath: "/projects/alpha",
        updatedAt: 2000,
      })
      .run();
    db.index
      .insert(schema.sessions)
      .values([
        {
          id: "sess-1",
          projectId: "proj-a",
          title: "Fix login",
          messageCount: 5,
          isSidechain: 0,
          createdAt: 1000,
          mtimeMs: 3000,
          filePath: "/path/sess-1.jsonl",
        },
        {
          id: "sess-2",
          projectId: "proj-a",
          title: "Add tests",
          messageCount: 3,
          isSidechain: 0,
          createdAt: 500,
          mtimeMs: 2000,
          filePath: "/path/sess-2.jsonl",
        },
      ])
      .run();
  });

  it("isSessionStarred returns false for unstarred session", () => {
    expect(isSessionStarred(db.index, "sess-1")).toBe(false);
  });

  it("toggleStar stars and unstars a session", () => {
    const starred = toggleStar(db.index, "sess-1");
    expect(starred).toBe(true);
    expect(isSessionStarred(db.index, "sess-1")).toBe(true);

    const unstarred = toggleStar(db.index, "sess-1");
    expect(unstarred).toBe(false);
    expect(isSessionStarred(db.index, "sess-1")).toBe(false);
  });

  it("getStarredSessionIds returns set of starred IDs", () => {
    toggleStar(db.index, "sess-1");
    toggleStar(db.index, "sess-2");

    const ids = getStarredSessionIds(db.index);
    expect(ids.size).toBe(2);
    expect(ids.has("sess-1")).toBe(true);
    expect(ids.has("sess-2")).toBe(true);
  });

  it("getStarredSessions returns full session entries", () => {
    toggleStar(db.index, "sess-1");

    const sessions = getStarredSessions(db.index);
    expect(
      sessions.map((s) => ({
        id: s.id,
        title: s.title,
        projectName: s.projectName,
      })),
    ).toStrictEqual([{ id: "sess-1", title: "Fix login", projectName: "Alpha" }]);
  });

  it("getStarredSessions returns empty array when none starred", () => {
    expect(getStarredSessions(db.index)).toStrictEqual([]);
  });
});

describe("message content FTS", () => {
  beforeEach(async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      makeSessionsIndex([
        {
          sessionId: "fts-sess-1",
          fullPath: join(projectDir, "fts-sess-1.jsonl"),
          fileMtime: Date.now(),
          firstPrompt: "Hello",
          messageCount: 2,
        },
      ]),
    );
    await indexSessionsIndex(db.index, projectDir, "-Users-craig-projects-app");

    writeFileSync(
      join(projectDir, "fts-sess-1.jsonl"),
      jsonl(
        {
          type: "user",
          message: {
            role: "user",
            content: "Fix the authentication bug in the login form",
          },
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "I found the issue in the session middleware",
              },
            ],
          },
        },
      ),
    );
    await indexJsonlFile(
      db.index,
      join(projectDir, "fts-sess-1.jsonl"),
      "-Users-craig-projects-app",
    );
  });

  it("indexes and searches message content", () => {
    const results = searchMessageContentDb(db.index, "authentication");
    expect(results.map((r) => r.sessionId)).toStrictEqual(["fts-sess-1"]);
  });

  it("finds assistant message content", () => {
    const results = searchMessageContentDb(db.index, "middleware");
    expect(results.map((r) => r.sessionId)).toStrictEqual(["fts-sess-1"]);
  });

  it("returns snippet with highlight marks", () => {
    const results = searchMessageContentDb(db.index, "login");
    expect(results.map((r) => r.sessionId)).toStrictEqual(["fts-sess-1"]);
    expect(results[0]!.snippet).toContain("<mark>");
  });

  it("escapes HTML in message search snippets while preserving highlights", () => {
    db.index.run(
      sql`INSERT INTO message_content_fts(session_id, content)
          VALUES (${"fts-xss"}, ${"login <script>alert(1)</script>"})`,
    );

    const result = searchMessageContentDb(db.index, "login").find(
      (searchResult) => searchResult.sessionId === "fts-xss",
    );
    if (!result) throw new Error("Expected an unsafe message search result");
    expect(result.snippet).toBe("<mark>login</mark> &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("returns empty for non-matching query", () => {
    const results = searchMessageContentDb(db.index, "nonexistent");
    expect(results.length).toBe(0);
  });

  it.each(['foo"bar', "a AND"])("returns no message content for malformed query %s", (query) => {
    expect(searchMessageContentDb(db.index, query)).toStrictEqual([]);
  });
});

describe("task indexer", () => {
  function makeTaskFile(task: Record<string, unknown>): string {
    return JSON.stringify({
      id: "1",
      subject: "Test task",
      description: "Test description",
      status: "pending",
      blocks: [],
      blockedBy: [],
      ...task,
    });
  }

  it("indexes a task file", async () => {
    const tasksDir = join(testDir, "tasks", "my-project");
    mkdirSync(tasksDir, { recursive: true });

    const filePath = join(tasksDir, "1.json");
    writeFileSync(filePath, makeTaskFile({ id: "1", subject: "Fix bug", status: "completed" }));

    await indexTaskFile(db.index, filePath, "my-project");

    const tasks = db.index.select().from(schema.tasks).all();
    if (tasks.length !== 1) throw new Error(`Expected 1 task, got ${tasks.length}`);
    expect(tasks[0]!.taskId).toBe("1");
    expect(tasks[0]!.projectDir).toBe("my-project");
    expect(tasks[0]!.subject).toBe("Fix bug");
    expect(tasks[0]!.status).toBe("completed");
  });

  it("stores blocks and blockedBy as JSON", async () => {
    const tasksDir = join(testDir, "tasks", "my-project");
    mkdirSync(tasksDir, { recursive: true });

    const filePath = join(tasksDir, "2.json");
    writeFileSync(filePath, makeTaskFile({ id: "2", blocks: ["3"], blockedBy: ["1"] }));

    await indexTaskFile(db.index, filePath, "my-project");

    const tasks = db.index.select().from(schema.tasks).all();
    if (tasks.length !== 1) throw new Error(`Expected 1 task, got ${tasks.length}`);
    expect(JSON.parse(tasks[0]!.blocksJson)).toStrictEqual(["3"]);
    expect(JSON.parse(tasks[0]!.blockedByJson)).toStrictEqual(["1"]);
  });

  it("stores metadata as JSON", async () => {
    const tasksDir = join(testDir, "tasks", "my-project");
    mkdirSync(tasksDir, { recursive: true });

    const filePath = join(tasksDir, "2.json");
    const metadata = {
      commit_sha: "fac216c",
      verification: { status: "passed", tests: 12 },
    };
    writeFileSync(filePath, makeTaskFile({ id: "2", metadata }));

    await indexTaskFile(db.index, filePath, "my-project");

    const tasks = db.index.select().from(schema.tasks).all();
    if (tasks.length !== 1) throw new Error(`Expected 1 task, got ${tasks.length}`);
    expect(JSON.parse(tasks[0]!.metadataJson)).toStrictEqual(metadata);
  });

  it("indexes the task owner", async () => {
    const tasksDir = join(testDir, "tasks", "example-project");
    mkdirSync(tasksDir, { recursive: true });

    const filePath = join(tasksDir, "owner-task.json");
    writeFileSync(filePath, makeTaskFile({ id: "owner-task", owner: "alice" }));

    await indexTaskFile(db.index, filePath, "example-project");

    expect(
      db.index
        .select({
          taskId: schema.tasks.taskId,
          projectDir: schema.tasks.projectDir,
          owner: schema.tasks.owner,
        })
        .from(schema.tasks)
        .all(),
    ).toStrictEqual([
      {
        taskId: "owner-task",
        projectDir: "example-project",
        owner: "alice",
      },
    ]);
  });

  it("skips re-indexing when mtime unchanged", async () => {
    const tasksDir = join(testDir, "tasks", "my-project");
    mkdirSync(tasksDir, { recursive: true });

    const filePath = join(tasksDir, "1.json");
    writeFileSync(filePath, makeTaskFile({}));

    await indexTaskFile(db.index, filePath, "my-project");
    const firstIndexed = db.index
      .select()
      .from(schema.indexedFiles)
      .where(eq(schema.indexedFiles.path, filePath))
      .get();

    await indexTaskFile(db.index, filePath, "my-project");
    const secondIndexed = db.index
      .select()
      .from(schema.indexedFiles)
      .where(eq(schema.indexedFiles.path, filePath))
      .get();

    if (!firstIndexed) throw new Error("Expected indexed_files entry after first index");
    if (!secondIndexed) throw new Error("Expected indexed_files entry after second index");
    expect(secondIndexed.indexedAt).toBe(firstIndexed.indexedAt);
  });

  it("re-indexes when indexed_files entry exists but tasks row is missing", async () => {
    const tasksDir = join(testDir, "tasks", "my-project");
    mkdirSync(tasksDir, { recursive: true });

    const filePath = join(tasksDir, "1.json");
    writeFileSync(filePath, makeTaskFile({ id: "1", subject: "Fix bug" }));

    await indexTaskFile(db.index, filePath, "my-project");
    expect(db.index.select().from(schema.tasks).all().length).toBe(1);

    db.index.delete(schema.tasks).where(eq(schema.tasks.filePath, filePath)).run();
    expect(db.index.select().from(schema.tasks).all()).toStrictEqual([]);
    if (
      !db.index
        .select()
        .from(schema.indexedFiles)
        .where(eq(schema.indexedFiles.path, filePath))
        .get()
    ) {
      throw new Error("Expected indexed_files entry to remain");
    }

    await indexTaskFile(db.index, filePath, "my-project");
    const tasksAfter = db.index.select().from(schema.tasks).all();
    expect(tasksAfter.map((t) => t.subject)).toStrictEqual(["Fix bug"]);
  });

  it("re-indexes when file changes", async () => {
    const tasksDir = join(testDir, "tasks", "my-project");
    mkdirSync(tasksDir, { recursive: true });

    const filePath = join(tasksDir, "1.json");
    writeFileSync(filePath, makeTaskFile({ status: "pending" }));

    await indexTaskFile(db.index, filePath, "my-project");
    expect(db.index.select().from(schema.tasks).all()[0]?.status).toBe("pending");

    await new Promise((r) => setTimeout(r, 50));

    writeFileSync(filePath, makeTaskFile({ status: "completed" }));
    await indexTaskFile(db.index, filePath, "my-project");
    expect(db.index.select().from(schema.tasks).all()[0]?.status).toBe("completed");
  });
});

describe("scanTasksDir", () => {
  it("indexes task files across project directories", async () => {
    const tasksDir = join(testDir, "tasks");
    const proj1 = join(tasksDir, "project-a");
    const proj2 = join(tasksDir, "project-b");
    mkdirSync(proj1, { recursive: true });
    mkdirSync(proj2, { recursive: true });

    writeFileSync(
      join(proj1, "1.json"),
      JSON.stringify({
        id: "1",
        subject: "Task A",
        description: "desc",
        status: "pending",
        blocks: [],
        blockedBy: [],
      }),
    );
    writeFileSync(
      join(proj2, "2.json"),
      JSON.stringify({
        id: "2",
        subject: "Task B",
        description: "desc",
        status: "completed",
        blocks: [],
        blockedBy: [],
      }),
    );

    await scanTasksDir(db.index, tasksDir);

    const tasks = db.index.select().from(schema.tasks).all();
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.projectDir).sort()).toStrictEqual(["project-a", "project-b"]);
  });

  it("cleans up deleted files", async () => {
    const tasksDir = join(testDir, "tasks");
    const proj = join(tasksDir, "my-proj");
    mkdirSync(proj, { recursive: true });

    const filePath = join(proj, "1.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        id: "1",
        subject: "Task",
        description: "desc",
        status: "pending",
        blocks: [],
        blockedBy: [],
      }),
    );

    await scanTasksDir(db.index, tasksDir);
    expect(db.index.select().from(schema.tasks).all().length).toBe(1);

    rmSync(filePath);
    await scanTasksDir(db.index, tasksDir);
    expect(db.index.select().from(schema.tasks).all()).toStrictEqual([]);
  });
});

describe("task queries", () => {
  const projectId = "-Users-craig-projects-app";
  const sessionId = "12345678-1234-1234-1234-123456789abc";

  beforeEach(async () => {
    db.index
      .insert(schema.projects)
      .values({ id: projectId, name: "example-app", updatedAt: 1000 })
      .run();
    db.index
      .insert(schema.sessions)
      .values({
        id: sessionId,
        projectId,
        title: "Example task owner session",
        messageCount: 1,
        isSidechain: 0,
        createdAt: 1000,
        mtimeMs: 1000,
        filePath: `/projects/${projectId}/${sessionId}.jsonl`,
      })
      .run();

    const tasksDir = join(testDir, "tasks", sessionId);
    mkdirSync(tasksDir, { recursive: true });

    writeFileSync(
      join(tasksDir, "1.json"),
      JSON.stringify({
        id: "1",
        subject: "Fix bug",
        description: "Fix it",
        status: "completed",
        blocks: ["2"],
        blockedBy: [],
        owner: "alice",
        metadata: {
          commit_sha: "fac216c",
          verification: { status: "passed" },
        },
      }),
    );
    writeFileSync(
      join(tasksDir, "2.json"),
      JSON.stringify({
        id: "2",
        subject: "Write tests",
        description: "Test it",
        status: "pending",
        blocks: [],
        blockedBy: ["1"],
      }),
    );
    writeFileSync(
      join(tasksDir, "3.json"),
      JSON.stringify({
        id: "3",
        subject: "Deploy",
        description: "Ship it",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
        activeForm: "Deploying",
      }),
    );
    await scanTasksDir(db.index, join(testDir, "tasks"));
  });

  it("getTasksForProject returns all tasks for a project", () => {
    const tasks = getTasksForProject(db.index, projectId);
    expect(tasks.map((t) => t.subject).sort()).toStrictEqual(["Deploy", "Fix bug", "Write tests"]);
    expect(tasks.map((task) => task.projectDir)).toStrictEqual([sessionId, sessionId, sessionId]);
  });

  it("getTasksForProject parses blocks/blockedBy", () => {
    const tasks = getTasksForProject(db.index, projectId);
    const task1 = tasks.find((t) => t.taskId === "1");
    if (!task1) throw new Error("Expected task with id 1");
    expect(task1.blocks).toStrictEqual(["2"]);
    expect(task1.blockedBy).toStrictEqual([]);

    const task2 = tasks.find((t) => t.taskId === "2");
    if (!task2) throw new Error("Expected task with id 2");
    expect(task2.blockedBy).toStrictEqual(["1"]);
  });

  it("getTasksForProject parses metadata", () => {
    const tasks = getTasksForProject(db.index, projectId);
    const task = tasks.find((candidate) => candidate.taskId === "1");
    if (!task) throw new Error("Expected task with id 1");
    expect(task.metadata).toStrictEqual({
      commit_sha: "fac216c",
      verification: { status: "passed" },
    });
  });

  it("getTasksForProject returns the indexed owner", () => {
    const tasks = getTasksForProject(db.index, projectId);
    expect(
      tasks
        .map(({ taskId, owner }) => ({ taskId, owner }))
        .sort((left, right) => left.taskId.localeCompare(right.taskId)),
    ).toStrictEqual([
      { taskId: "1", owner: "alice" },
      { taskId: "2", owner: null },
      { taskId: "3", owner: null },
    ]);
  });

  it("getTasksForProject returns empty for unknown project", () => {
    expect(getTasksForProject(db.index, "nonexistent")).toStrictEqual([]);
  });

  it("getTaskCountsForProject aggregates correctly", () => {
    const counts = getTaskCountsForProject(db.index, projectId);
    expect(counts.total).toBe(3);
    expect(counts.completed).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.inProgress).toBe(1);
  });

  it("getTaskCountsForProject returns zeros for unknown project", () => {
    const counts = getTaskCountsForProject(db.index, "nonexistent");
    expect(counts).toStrictEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
    });
  });

  function insertUnmatchedDirTasks() {
    db.index
      .insert(schema.tasks)
      .values([
        {
          taskId: "600",
          projectDir: "example-app",
          subject: "Project-dir task",
          description: "desc",
          status: "pending",
          blocksJson: "[]",
          blockedByJson: "[]",
          metadataJson: "{}",
          filePath: "/tasks/example-app/600.json",
          mtimeMs: 1000,
        },
        {
          taskId: "601",
          projectDir: "session-12345678",
          subject: "Prefixed-dir task",
          description: "desc",
          status: "in_progress",
          blocksJson: "[]",
          blockedByJson: "[]",
          metadataJson: "{}",
          filePath: "/tasks/session-12345678/601.json",
          mtimeMs: 1000,
        },
      ])
      .run();
  }

  it("getTaskCountsForProject counts tasks stored under project-name and session-prefix directories", () => {
    insertUnmatchedDirTasks();

    expect(getTaskCountsForProject(db.index, projectId)).toStrictEqual({
      total: 5,
      pending: 2,
      inProgress: 2,
      completed: 1,
    });
  });

  it("getTasksForProject includes tasks stored under project-name and session-prefix directories", () => {
    insertUnmatchedDirTasks();

    const subjects = getTasksForProject(db.index, projectId)
      .map((task) => task.subject)
      .sort();
    expect(subjects).toStrictEqual([
      "Deploy",
      "Fix bug",
      "Prefixed-dir task",
      "Project-dir task",
      "Write tests",
    ]);
  });

  it("getOpenTasksForProject includes tasks stored under project-name and session-prefix directories", () => {
    insertUnmatchedDirTasks();

    const subjects = getOpenTasksForProject(db.index, projectId, 10).map((task) => task.subject);
    expect(subjects).toStrictEqual([
      "Deploy",
      "Prefixed-dir task",
      "Write tests",
      "Project-dir task",
    ]);
  });

  it("project taskCount totals agree with the incomplete-task grouping", () => {
    insertUnmatchedDirTasks();

    const projects = db.index.select({ id: schema.projects.id }).from(schema.projects).all();
    const summedTaskCount = projects.reduce((total, project) => {
      const counts = getTaskCountsForProject(db.index, project.id);
      return total + counts.pending + counts.inProgress;
    }, 0);
    const groupedTaskCount = getIncompleteTasksGroupedByProject(db.index).reduce(
      (total, group) => total + group.tasks.length,
      0,
    );
    expect(summedTaskCount).toBe(4);
    expect(summedTaskCount).toBe(groupedTaskCount);
  });

  it("getIncompleteTasksGroupedByProject resolves a UUID-named task directory to its owning session", () => {
    const groups = getIncompleteTasksGroupedByProject(db.index);
    expect(
      groups.map(({ tasks, ...group }) => ({
        ...group,
        taskIds: tasks.map((task) => task.taskId).sort(),
      })),
    ).toStrictEqual([
      {
        projectId,
        projectName: "example-app",
        projectDir: sessionId,
        sessionId,
        sessionTitle: "Example task owner session",
        taskIds: ["2", "3"],
        totalPending: 1,
        totalInProgress: 1,
      },
    ]);
  });

  it("getIncompleteTasksGroupedByProject preserves tasks whose session is missing", () => {
    const missingSessionId = "00000000-0000-0000-0000-000000000000";
    db.index
      .insert(schema.tasks)
      .values({
        taskId: "100",
        projectDir: missingSessionId,
        subject: "Orphaned task",
        description: "Keep this visible",
        status: "pending",
        blocksJson: "[]",
        blockedByJson: "[]",
        metadataJson: "{}",
        filePath: `/tasks/${missingSessionId}/100.json`,
        mtimeMs: 1000,
      })
      .run();

    const orphanedGroup = getIncompleteTasksGroupedByProject(db.index).find(
      (group) => group.projectDir === missingSessionId,
    );
    expect(orphanedGroup).toStrictEqual({
      projectId: ORPHANED_TASKS_PROJECT_ID,
      projectName: "Orphaned tasks",
      projectDir: missingSessionId,
      sessionId: null,
      sessionTitle: "Unindexed session 00000000",
      tasks: [
        {
          taskId: "100",
          projectDir: missingSessionId,
          subject: "Orphaned task",
          description: "Keep this visible",
          status: "pending",
          activeForm: null,
          owner: null,
          blocks: [],
          blockedBy: [],
          metadata: {},
        },
      ],
      totalPending: 1,
      totalInProgress: 0,
    });
  });

  it("getIncompleteTasksGroupedByProject never repeats one string as both project and session label", () => {
    const missingSessionId = "deadbeef-0000-0000-0000-000000000000";
    db.index
      .insert(schema.tasks)
      .values({
        taskId: "101",
        projectDir: missingSessionId,
        subject: "Orphaned task",
        description: "desc",
        status: "pending",
        blocksJson: "[]",
        blockedByJson: "[]",
        metadataJson: "{}",
        filePath: `/tasks/${missingSessionId}/101.json`,
        mtimeMs: 1000,
      })
      .run();

    for (const group of getIncompleteTasksGroupedByProject(db.index)) {
      expect(group.projectName).not.toBe(group.sessionTitle);
    }
  });

  it("getIncompleteTasksGroupedByProject labels an unresolvable session-prefixed directory as orphaned", () => {
    db.index
      .insert(schema.tasks)
      .values({
        taskId: "102",
        projectDir: "session-fedcba98",
        subject: "Orphaned prefixed task",
        description: "desc",
        status: "pending",
        blocksJson: "[]",
        blockedByJson: "[]",
        metadataJson: "{}",
        filePath: "/tasks/session-fedcba98/102.json",
        mtimeMs: 1000,
      })
      .run();

    const group = getIncompleteTasksGroupedByProject(db.index).find(
      (candidate) => candidate.projectDir === "session-fedcba98",
    );
    if (!group) throw new Error("Expected group for session-fedcba98");
    expect({
      projectId: group.projectId,
      projectName: group.projectName,
      sessionId: group.sessionId,
      sessionTitle: group.sessionTitle,
    }).toStrictEqual({
      projectId: ORPHANED_TASKS_PROJECT_ID,
      projectName: "Orphaned tasks",
      sessionId: null,
      sessionTitle: "Unindexed session fedcba98",
    });
  });

  it("getIncompleteTasksGroupedByProject sorts orphaned groups after resolved ones", () => {
    db.index
      .insert(schema.tasks)
      .values([
        {
          taskId: "103",
          projectDir: "11111111-1111-1111-1111-111111111111",
          subject: "Orphaned task",
          description: "desc",
          status: "pending",
          blocksJson: "[]",
          blockedByJson: "[]",
          metadataJson: "{}",
          filePath: "/tasks/11111111-1111-1111-1111-111111111111/103.json",
          mtimeMs: 1000,
        },
        {
          taskId: "104",
          projectDir: "example-app",
          subject: "Project-dir task",
          description: "desc",
          status: "pending",
          blocksJson: "[]",
          blockedByJson: "[]",
          metadataJson: "{}",
          filePath: "/tasks/example-app/104.json",
          mtimeMs: 1000,
        },
      ])
      .run();

    const groups = getIncompleteTasksGroupedByProject(db.index);
    expect(
      groups.map((group) => ({ projectDir: group.projectDir, projectId: group.projectId })),
    ).toStrictEqual([
      { projectDir: sessionId, projectId },
      { projectDir: "example-app", projectId },
      {
        projectDir: "11111111-1111-1111-1111-111111111111",
        projectId: ORPHANED_TASKS_PROJECT_ID,
      },
    ]);
  });

  it("getIncompleteTasksGroupedByProject resolves a session-prefixed task directory by id prefix", () => {
    db.index
      .insert(schema.tasks)
      .values({
        taskId: "200",
        projectDir: "session-12345678",
        subject: "Prefixed task",
        description: "desc",
        status: "pending",
        blocksJson: "[]",
        blockedByJson: "[]",
        metadataJson: "{}",
        filePath: "/tasks/session-12345678/200.json",
        mtimeMs: 1000,
      })
      .run();

    const group = getIncompleteTasksGroupedByProject(db.index).find(
      (candidate) => candidate.projectDir === "session-12345678",
    );
    if (!group) throw new Error("Expected group for session-12345678");
    expect(group.projectId).toBe(projectId);
    expect(group.projectName).toBe("example-app");
    expect(group.sessionId).toBe(sessionId);
    expect(group.sessionTitle).toBe("Example task owner session");
  });

  it("getIncompleteTasksGroupedByProject resolves a project-name task directory via the projects table", () => {
    db.index
      .insert(schema.tasks)
      .values({
        taskId: "300",
        projectDir: "example-app",
        subject: "Project-level task",
        description: "desc",
        status: "pending",
        blocksJson: "[]",
        blockedByJson: "[]",
        metadataJson: "{}",
        filePath: "/tasks/example-app/300.json",
        mtimeMs: 1000,
      })
      .run();

    const group = getIncompleteTasksGroupedByProject(db.index).find(
      (candidate) => candidate.projectDir === "example-app",
    );
    if (!group) throw new Error("Expected group for example-app");
    expect(group.projectId).toBe(projectId);
    expect(group.projectName).toBe("example-app");
    expect(group.sessionId).toBeNull();
    expect(group.sessionTitle).toBe("Project tasks");
  });

  it("getIncompleteTasksGroupedByProject labels an unmatched plain-name task directory with the directory name", () => {
    db.index
      .insert(schema.tasks)
      .values({
        taskId: "400",
        projectDir: "factorio-school",
        subject: "Loose task",
        description: "desc",
        status: "pending",
        blocksJson: "[]",
        blockedByJson: "[]",
        metadataJson: "{}",
        filePath: "/tasks/factorio-school/400.json",
        mtimeMs: 1000,
      })
      .run();

    const group = getIncompleteTasksGroupedByProject(db.index).find(
      (candidate) => candidate.projectDir === "factorio-school",
    );
    if (!group) throw new Error("Expected group for factorio-school");
    expect(group.projectId).toBe("factorio-school");
    expect(group.projectName).toBe("factorio-school");
    expect(group.sessionId).toBeNull();
    expect(group.sessionTitle).toBe("Project tasks");
  });

  it("getIncompleteTasksGroupedByProject resolves a dashed task directory whose project name contains a dot", () => {
    const dottedProjectId = "-Users-craig-projects-factorio-school";
    db.index
      .insert(schema.projects)
      .values({ id: dottedProjectId, name: "factorio.school", updatedAt: 1000 })
      .run();
    db.index
      .insert(schema.tasks)
      .values({
        taskId: "450",
        projectDir: "factorio-school",
        subject: "Dotted-name task",
        description: "desc",
        status: "pending",
        blocksJson: "[]",
        blockedByJson: "[]",
        metadataJson: "{}",
        filePath: "/tasks/factorio-school/450.json",
        mtimeMs: 1000,
      })
      .run();

    const group = getIncompleteTasksGroupedByProject(db.index).find(
      (candidate) => candidate.projectDir === "factorio-school",
    );
    if (!group) throw new Error("Expected group for factorio-school");
    expect(group.projectId).toBe(dottedProjectId);
    expect(group.projectName).toBe("factorio.school");
    expect(group.sessionId).toBeNull();
    expect(group.sessionTitle).toBe("Project tasks");

    const projectTasks = getTasksForProject(db.index, dottedProjectId);
    expect(projectTasks.map((task) => task.taskId)).toStrictEqual(["450"]);
  });

  it("getIncompleteTasksGroupedByProject leaves an ambiguous project-name directory unresolved", () => {
    db.index
      .insert(schema.projects)
      .values([
        { id: "-Users-craig-projects-a-dupe", name: "dupe", updatedAt: 1000 },
        { id: "-Users-craig-projects-b-dupe", name: "dupe", updatedAt: 1000 },
      ])
      .run();
    db.index
      .insert(schema.tasks)
      .values({
        taskId: "500",
        projectDir: "dupe",
        subject: "Ambiguous task",
        description: "desc",
        status: "pending",
        blocksJson: "[]",
        blockedByJson: "[]",
        metadataJson: "{}",
        filePath: "/tasks/dupe/500.json",
        mtimeMs: 1000,
      })
      .run();

    const group = getIncompleteTasksGroupedByProject(db.index).find(
      (candidate) => candidate.projectDir === "dupe",
    );
    if (!group) throw new Error("Expected group for dupe");
    expect(group.projectId).toBe("dupe");
    expect(group.projectName).toBe("dupe");
    expect(group.sessionId).toBeNull();
    expect(group.sessionTitle).toBe("Project tasks");
  });

  it("getIncompleteTasksGroupedByProject returns empty when all completed", async () => {
    const tasksDir = join(testDir, "tasks", sessionId);
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(
      join(tasksDir, "2.json"),
      JSON.stringify({
        id: "2",
        subject: "Write tests",
        description: "Test it",
        status: "completed",
        blocks: [],
        blockedBy: ["1"],
      }),
    );
    writeFileSync(
      join(tasksDir, "3.json"),
      JSON.stringify({
        id: "3",
        subject: "Deploy",
        description: "Ship it",
        status: "completed",
        blocks: [],
        blockedBy: [],
      }),
    );
    await scanTasksDir(db.index, join(testDir, "tasks"));

    const groups = getIncompleteTasksGroupedByProject(db.index);
    expect(groups).toStrictEqual([]);
  });
});
