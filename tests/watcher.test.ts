import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  __testing,
  createWatcher,
  shouldIgnoreWatch,
  resolveIgnoredDirNames,
  buildIgnoredDirPattern,
} from "../src/lib/watcher";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import { hmrPersist } from "../src/lib/hmr-persist";
import { DOMAIN_EVENTS } from "../src/lib/hook-events";
import { eq, sql } from "drizzle-orm";
import type { SessionEntry } from "../src/lib/sessions";
import * as sessions from "../src/lib/sessions";
import type { TaskRow } from "../src/lib/db/queries";
import {
  markSessionActive,
  markSessionEnded,
  setSessionState,
} from "../src/lib/active-session-store";
import * as recursiveWatch from "../src/lib/recursive-watch";
import type { RecursiveWatcher } from "../src/lib/recursive-watch";

const {
  toSessionSummaryPayload,
  sessionSummariesEqual,
  toTaskSummaryPayload,
  tasksEqual,
  handleJsonlPlanLinks,
  handlePlanMdChange,
  handlePlanMdUnlink,
} = __testing;

interface CapturedBroadcast {
  type: string;
  data: Record<string, unknown>;
}

function jsonl(...lines: Record<string, unknown>[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function makeSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: "sess-1",
    title: "Hello",
    firstPrompt: undefined,
    summary: undefined,
    customTitle: undefined,
    mtime: new Date("1999-12-31T00:00:00.000Z"),
    created: new Date("1999-12-30T00:00:00.000Z"),
    project: "project-1",
    projectName: "Project 1",
    messageCount: 3,
    gitBranch: undefined,
    isSidechain: false,
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    taskId: "task-1",
    projectDir: "proj",
    subject: "Do a thing",
    description: "Details",
    status: "pending",
    activeForm: null,
    owner: null,
    blocks: [],
    blockedBy: [],
    metadata: {},
    ...overrides,
  };
}

function createLinkedWorktree(
  repositoryDirectory: string,
  fixtureDirectory: string,
): { repositoryIndexPath: string; worktreeDirectory: string } {
  writeFileSync(join(repositoryDirectory, "initial.txt"), "Initial tracked content.\n");
  execFileSync("git", ["add", "initial.txt"], { cwd: repositoryDirectory, stdio: "pipe" });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Alice",
      "-c",
      "user.email=alice@example.com",
      "commit",
      "--quiet",
      "--message=Initial test commit",
    ],
    { cwd: repositoryDirectory, stdio: "pipe" },
  );

  const worktreeDirectory = join(fixtureDirectory, "worktree");
  execFileSync("git", ["worktree", "add", "--quiet", "--detach", worktreeDirectory], {
    cwd: repositoryDirectory,
    stdio: "pipe",
  });
  const repositoryIndexPath = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-path", "index"],
    { cwd: worktreeDirectory, encoding: "utf8" },
  ).trim();
  return { repositoryIndexPath, worktreeDirectory };
}

describe("handleFileChange", () => {
  const testDir = join(tmpdir(), "watcher-debounce-test-" + process.pid);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
    __testing.resetJsonlThrottle();
  });

  afterEach(() => {
    __testing.resetJsonlThrottle();
    vi.restoreAllMocks();
    vi.useRealTimers();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("fires changes for two interleaved JSONL paths", async () => {
    const alicePath = join(testDir, "alice-session.jsonl");
    const bobPath = join(testDir, "bob-session.jsonl");
    const aliceFirstLine = jsonl({ type: "user", sessionId: "alice-session" });
    const aliceSecondLine = jsonl({ type: "assistant", sessionId: "alice-session" });
    writeFileSync(alicePath, aliceFirstLine);
    writeFileSync(bobPath, jsonl({ type: "user", sessionId: "bob-session" }));
    const readNewJsonlLines = vi.spyOn(sessions, "readNewJsonlLines");

    await __testing.handleFileChange(alicePath);
    await vi.advanceTimersByTimeAsync(100);
    await __testing.handleFileChange(bobPath);
    await vi.advanceTimersByTimeAsync(100);
    appendFileSync(alicePath, aliceSecondLine);
    await __testing.handleFileChange(alicePath);
    await vi.advanceTimersByTimeAsync(1_800);

    expect(new Set(readNewJsonlLines.mock.calls.map(([path]) => path))).toStrictEqual(
      new Set([alicePath, bobPath]),
    );
  });
});

describe("handleFileChange file content", () => {
  let db: AppDb;
  let fixtureDirectory: string;
  let repositoryDirectory: string;

  beforeAll(() => {
    db = openTestDb();
    hmrPersist("appDb", () => db);
  });

  beforeEach(() => {
    const fixtureRoot = join(process.cwd(), ".llm");
    mkdirSync(fixtureRoot, { recursive: true });
    fixtureDirectory = mkdtempSync(join(fixtureRoot, "watcher-file-content-test-"));
    repositoryDirectory = join(fixtureDirectory, "repository");
    mkdirSync(repositoryDirectory);
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], {
      cwd: repositoryDirectory,
      stdio: "pipe",
    });
    __testing.setFileContentRoots([repositoryDirectory]);
  });

  afterEach(() => {
    __testing.setFileContentRoots([]);
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  afterAll(() => {
    db.close();
  });

  it("indexes an untracked file only after git add changes the repository index", async () => {
    const filePath = join(repositoryDirectory, "alice.txt");
    const gitIndexPath = join(repositoryDirectory, ".git", "index");
    writeFileSync(filePath, "Alice's searchable file content.\n");

    await __testing.handleFileChange(gitIndexPath);
    await __testing.handleFileChange(filePath);
    const rowsBeforeAdd = db.index.all(
      sql`SELECT path, content FROM file_content_fts ORDER BY path`,
    );

    execFileSync("git", ["add", "alice.txt"], { cwd: repositoryDirectory, stdio: "pipe" });
    await __testing.handleFileChange(gitIndexPath);
    const rowsAfterAdd = db.index.all(
      sql`SELECT path, content FROM file_content_fts ORDER BY path`,
    );

    execFileSync("git", ["rm", "--cached", "alice.txt"], {
      cwd: repositoryDirectory,
      stdio: "pipe",
    });
    await __testing.handleFileChange(gitIndexPath);
    const rowsAfterRemoval = db.index.all(
      sql`SELECT path, content FROM file_content_fts ORDER BY path`,
    );

    expect({ rowsAfterAdd, rowsAfterRemoval, rowsBeforeAdd }).toStrictEqual({
      rowsAfterAdd: [{ path: filePath, content: "Alice's searchable file content.\n" }],
      rowsAfterRemoval: [],
      rowsBeforeAdd: [],
    });
  });

  it("indexes a newly tracked file when a linked worktree index changes", async () => {
    const { repositoryIndexPath, worktreeDirectory } = createLinkedWorktree(
      repositoryDirectory,
      fixtureDirectory,
    );
    __testing.setFileContentRoots([worktreeDirectory]);
    const filePath = join(worktreeDirectory, "alice.txt");
    writeFileSync(filePath, "Alice's linked worktree content.\n");

    execFileSync("git", ["add", "alice.txt"], { cwd: worktreeDirectory, stdio: "pipe" });
    await __testing.handleFileChange(repositoryIndexPath);
    const rows = db.index.all(sql`SELECT path, content FROM file_content_fts ORDER BY path`);

    expect({ ignored: shouldIgnoreWatch(repositoryIndexPath), rows }).toStrictEqual({
      ignored: false,
      rows: [
        { path: filePath, content: "Alice's linked worktree content.\n" },
        { path: join(worktreeDirectory, "initial.txt"), content: "Initial tracked content.\n" },
      ],
    });
  });
});

describe("toSessionSummaryPayload", () => {
  it("serializes dates as ISO strings and preserves core fields", () => {
    const payload = toSessionSummaryPayload(makeSession(), false);

    expect(payload).toStrictEqual({
      id: "sess-1",
      title: "Hello",
      summary: undefined,
      mtime: "1999-12-31T00:00:00.000Z",
      created: "1999-12-30T00:00:00.000Z",
      project: "project-1",
      projectName: "Project 1",
      messageCount: 3,
      gitBranch: undefined,
      starred: false,
      state: "ended",
      blockedSince: null,
    });
  });

  it("reserves unknown for an active session whose state has not been reported", () => {
    markSessionActive("sess-1", { cwd: "/tmp/test/project-1" });

    try {
      const unreportedState = toSessionSummaryPayload(makeSession(), false).state;

      setSessionState("sess-1", "working");
      const reportedState = toSessionSummaryPayload(makeSession(), false).state;

      expect({ unreportedState, reportedState }).toStrictEqual({
        unreportedState: "unknown",
        reportedState: "working",
      });
    } finally {
      markSessionEnded("sess-1");
    }
  });

  it("reflects the starred flag from the caller", () => {
    const payload = toSessionSummaryPayload(makeSession(), true);
    expect(payload.starred).toBe(true);
  });
});

describe("sessionSummariesEqual", () => {
  it("returns true for identical summaries", () => {
    const a = toSessionSummaryPayload(makeSession(), false);
    const b = toSessionSummaryPayload(makeSession(), false);
    expect(sessionSummariesEqual(a, b)).toBe(true);
  });

  it("returns false when the title changes", () => {
    const a = toSessionSummaryPayload(makeSession(), false);
    const b = toSessionSummaryPayload(makeSession({ title: "Different" }), false);
    expect(sessionSummariesEqual(a, b)).toBe(false);
  });

  it("returns false when the mtime changes", () => {
    const a = toSessionSummaryPayload(makeSession(), false);
    const b = toSessionSummaryPayload(
      makeSession({ mtime: new Date("2000-01-01T00:00:00.000Z") }),
      false,
    );
    expect(sessionSummariesEqual(a, b)).toBe(false);
  });

  it("returns false when messageCount changes (new message appended)", () => {
    const a = toSessionSummaryPayload(makeSession(), false);
    const b = toSessionSummaryPayload(makeSession({ messageCount: 4 }), false);
    expect(sessionSummariesEqual(a, b)).toBe(false);
  });

  it("returns false when starred changes", () => {
    const a = toSessionSummaryPayload(makeSession(), false);
    const b = toSessionSummaryPayload(makeSession(), true);
    expect(sessionSummariesEqual(a, b)).toBe(false);
  });

  it("returns false when the fused activity state changes", () => {
    const summary = toSessionSummaryPayload(makeSession(), false);
    const waitingSummary = {
      ...summary,
      state: "waiting" as const,
      blockedSince: "2000-01-01T00:00:00.000Z",
    };

    expect(sessionSummariesEqual(summary, waitingSummary)).toBe(false);
  });
});

describe("toTaskSummaryPayload", () => {
  it("maps blocks/blockedBy arrays through unchanged", () => {
    const row = makeTask({ blocks: ["task-2"], blockedBy: ["task-3"] });

    const payload = toTaskSummaryPayload(row);

    expect(payload).toStrictEqual({
      taskId: "task-1",
      projectDir: "proj",
      subject: "Do a thing",
      description: "Details",
      status: "pending",
      activeForm: null,
      owner: null,
      blocks: ["task-2"],
      blockedBy: ["task-3"],
    });
  });
});

describe("tasksEqual", () => {
  it("returns true for identical tasks", () => {
    const a = toTaskSummaryPayload(makeTask());
    const b = toTaskSummaryPayload(makeTask());
    expect(tasksEqual(a, b)).toBe(true);
  });

  it("returns false when status changes from pending to completed", () => {
    const a = toTaskSummaryPayload(makeTask({ status: "pending" }));
    const b = toTaskSummaryPayload(makeTask({ status: "completed" }));
    expect(tasksEqual(a, b)).toBe(false);
  });

  it("returns false when owner changes", () => {
    const a = toTaskSummaryPayload(makeTask({ owner: "alice" }));
    const b = toTaskSummaryPayload(makeTask({ owner: "bob" }));
    expect(tasksEqual(a, b)).toBe(false);
  });

  it("returns false when blocks array changes order", () => {
    const a = toTaskSummaryPayload(makeTask({ blocks: ["a", "b"] }));
    const b = toTaskSummaryPayload(makeTask({ blocks: ["b", "a"] }));
    expect(tasksEqual(a, b)).toBe(false);
  });
});

describe("handleJsonlPlanLinks", () => {
  const testDir = join(tmpdir(), "claude-watcher-test-" + process.pid);
  let db: AppDb;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = openTestDb();
  });

  afterEach(() => {
    if (db) db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("broadcasts PLAN_CHANGED for each plan linked by a JSONL with a plan_mode line", async () => {
    const projectsDir = testDir;
    const plansDir = join(testDir, "plans");
    const projectDir = join(projectsDir, "-Users-craig-projects-app");
    mkdirSync(plansDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(plansDir, "gamma.md"), "# Gamma");

    const jsonlPath = join(projectDir, "sess-watcher.jsonl");
    writeFileSync(
      jsonlPath,
      jsonl(
        {
          type: "user",
          sessionId: "sess-watcher",
          message: { role: "user", content: "Draft" },
        },
        {
          type: "attachment",
          sessionId: "sess-watcher",
          attachment: {
            type: "plan_mode",
            planFilePath: "/Users/craig/.claude/plans/gamma.md",
          },
        },
      ),
    );

    const broadcasts: CapturedBroadcast[] = [];
    const result = await handleJsonlPlanLinks(
      db.index,
      jsonlPath,
      projectsDir,
      plansDir,
      (type, data) => broadcasts.push({ type, data }),
    );

    expect(result.linkedPlans).toStrictEqual(["gamma.md"]);
    const planEvents = broadcasts.filter((b) => b.type === DOMAIN_EVENTS.PLAN_CHANGED);
    expect(planEvents.length).toBe(1);
    const payload = planEvents[0]!.data as {
      plan: { filename: string; title: string };
    };
    expect(payload.plan.filename).toBe("gamma.md");
    expect(payload.plan.title).toBe("Gamma");
  });

  it("broadcasts nothing when the JSONL has no plan references", async () => {
    const projectsDir = testDir;
    const plansDir = join(testDir, "plans");
    const projectDir = join(projectsDir, "-Users-craig-projects-app");
    mkdirSync(plansDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    const jsonlPath = join(projectDir, "sess-no-plan.jsonl");
    writeFileSync(
      jsonlPath,
      jsonl({
        type: "user",
        sessionId: "sess-no-plan",
        message: { role: "user", content: "Hi" },
      }),
    );

    const broadcasts: CapturedBroadcast[] = [];
    const result = await handleJsonlPlanLinks(
      db.index,
      jsonlPath,
      projectsDir,
      plansDir,
      (type, data) => broadcasts.push({ type, data }),
    );

    expect(result.linkedPlans).toStrictEqual([]);
    expect(broadcasts.filter((b) => b.type === DOMAIN_EVENTS.PLAN_CHANGED)).toStrictEqual([]);
  });
});

describe("handlePlanMdChange", () => {
  const testDir = join(tmpdir(), "claude-watcher-md-test-" + process.pid);
  let db: AppDb;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = openTestDb();
  });

  afterEach(() => {
    if (db) db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("inserts the plans row before broadcasting PLAN_CHANGED", async () => {
    const projectsDir = join(testDir, "projects");
    const plansDir = join(testDir, "plans");
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(plansDir, { recursive: true });
    const mdPath = join(plansDir, "delta.md");
    writeFileSync(mdPath, "# Delta");

    let rowAtBroadcastTime: { filename: string; title: string } | null = null;

    await handlePlanMdChange(db.index, mdPath, projectsDir, plansDir, (type, data) => {
      if (type === DOMAIN_EVENTS.PLAN_CHANGED) {
        const rows = db.index
          .select({
            filename: schema.plans.filename,
            title: schema.plans.title,
          })
          .from(schema.plans)
          .where(eq(schema.plans.filename, "delta.md"))
          .all();
        rowAtBroadcastTime = rows[0] ?? null;
      }
      void data;
    });

    // At the time PLAN_CHANGED fired, the plans row must already be
    // present — the indexer wrote before the broadcast.
    expect(rowAtBroadcastTime).not.toBeNull();
    expect(rowAtBroadcastTime!.filename).toBe("delta.md");
    expect(rowAtBroadcastTime!.title).toBe("Delta");
  });
});

describe("handlePlanMdUnlink", () => {
  const testDir = join(tmpdir(), "claude-watcher-unlink-test-" + process.pid);
  let db: AppDb;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = openTestDb();
  });

  afterEach(() => {
    if (db) db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("deletes the row before broadcasting PLAN_REMOVED", () => {
    const plansDir = join(testDir, "plans");
    mkdirSync(plansDir, { recursive: true });
    const mdPath = join(plansDir, "epsilon.md");

    db.index
      .insert(schema.plans)
      .values({
        filename: "epsilon.md",
        title: "Epsilon",
        mtimeMs: 1_700_000_000_000,
      })
      .run();

    let rowCountAtBroadcast = -1;
    const broadcasts: CapturedBroadcast[] = [];

    handlePlanMdUnlink(db.index, mdPath, (type, data) => {
      broadcasts.push({ type, data });
      if (type === DOMAIN_EVENTS.PLAN_REMOVED) {
        rowCountAtBroadcast = db.index
          .select()
          .from(schema.plans)
          .where(eq(schema.plans.filename, "epsilon.md"))
          .all().length;
      }
    });

    // At broadcast time, the row was already deleted.
    expect(rowCountAtBroadcast).toBe(0);
    expect(broadcasts).toStrictEqual([
      { type: DOMAIN_EVENTS.PLAN_REMOVED, data: { filename: "epsilon.md" } },
    ]);
  });
});

describe("shouldIgnoreWatch", () => {
  const fileStats = {
    isFile: () => true,
    isDirectory: () => false,
  } as import("node:fs").Stats;
  const dirStats = {
    isFile: () => false,
    isDirectory: () => true,
  } as import("node:fs").Stats;
  const socketStats = {
    isFile: () => false,
    isDirectory: () => false,
  } as import("node:fs").Stats;

  // The module resolves ignored dirs from the real config.json / env at
  // load time. Pin it to the hard-coded defaults so these assertions are
  // deterministic regardless of the developer's environment.
  beforeEach(() => {
    __testing.resetIgnoredDirPattern();
  });
  afterEach(() => {
    __testing.resetIgnoredDirPattern();
    __testing.setFileContentRoots([]);
  });

  it("ignores .git directories at any depth", () => {
    expect(shouldIgnoreWatch("/foo/.git")).toBe(true);
    expect(shouldIgnoreWatch("/foo/.git/fsmonitor--daemon.ipc")).toBe(true);
    expect(shouldIgnoreWatch("/a/b/c/.git/HEAD")).toBe(true);
    expect(shouldIgnoreWatch(".git/config")).toBe(true);
  });

  it("ignores node_modules subtrees", () => {
    expect(shouldIgnoreWatch("/foo/node_modules")).toBe(true);
    expect(shouldIgnoreWatch("/foo/node_modules/react/package.json")).toBe(true);
  });

  it("ignores agent context subtrees", () => {
    expect(shouldIgnoreWatch("/foo/.llm")).toBe(true);
    expect(shouldIgnoreWatch("/foo/.llm/cached-repository/src/index.ts")).toBe(true);
  });

  it("ignores common build / cache / vendor directories", () => {
    expect(shouldIgnoreWatch("/foo/dist/bundle.js")).toBe(true);
    expect(shouldIgnoreWatch("/foo/build/output.json")).toBe(true);
    expect(shouldIgnoreWatch("/foo/out/index.html")).toBe(true);
    expect(shouldIgnoreWatch("/foo/coverage/report.json")).toBe(true);
    expect(shouldIgnoreWatch("/foo/.next/cache/x")).toBe(true);
    expect(shouldIgnoreWatch("/foo/.turbo/x")).toBe(true);
    expect(shouldIgnoreWatch("/foo/.vite/x")).toBe(true);
    expect(shouldIgnoreWatch("/foo/.cache/x")).toBe(true);
    expect(shouldIgnoreWatch("/foo/target/release/bin")).toBe(true);
  });

  it("does not ignore look-alike basenames in other positions", () => {
    expect(shouldIgnoreWatch("/foo/my-dist-tool/file.md", fileStats)).toBe(false);
    expect(shouldIgnoreWatch("/foo/distributed.md", fileStats)).toBe(false);
  });

  it("does not ignore watched files or directories", () => {
    expect(shouldIgnoreWatch("/foo/bar.md", fileStats)).toBe(false);
    expect(shouldIgnoreWatch("/foo/bar", dirStats)).toBe(false);
  });

  it("ignores non-regular files (sockets, FIFOs)", () => {
    expect(shouldIgnoreWatch("/foo/sock", socketStats)).toBe(true);
  });

  it("ignores files with non-watched extensions when stats indicate a file", () => {
    expect(shouldIgnoreWatch("/foo/bar.png", fileStats)).toBe(true);
    expect(shouldIgnoreWatch("/foo/bar.ts", fileStats)).toBe(true);
    expect(shouldIgnoreWatch("/foo/Makefile", fileStats)).toBe(true);
  });

  it("does not ignore watched extensions", () => {
    expect(shouldIgnoreWatch("/foo/bar.md", fileStats)).toBe(false);
    expect(shouldIgnoreWatch("/foo/bar.jsonl", fileStats)).toBe(false);
    expect(shouldIgnoreWatch("/foo/bar.json", fileStats)).toBe(false);
  });
});

describe("resolveIgnoredDirNames", () => {
  const configDir = mkdtempSync(join(tmpdir(), "watcher-config-test-"));
  const configPath = join(configDir, "config.json");
  const missingPath = join(configDir, "does-not-exist.json");

  afterEach(() => {
    rmSync(configPath, { force: true });
  });

  it("uses the hard-coded defaults when neither env var nor config provides values", () => {
    const resolved = resolveIgnoredDirNames(missingPath);
    expect([...resolved].sort()).toStrictEqual([...__testing.DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("overrides defaults with the ignored_dirs array in config.json", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["vendor", "tmp"] }));
    const resolved = resolveIgnoredDirNames(configPath);
    expect([...resolved].sort()).toStrictEqual(["tmp", "vendor"]);
  });

  it("ignores the retired environment alias when config is present", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["from-config"] }));
    process.env["CCP_WATCHER_IGNORED_DIRS"] = "from-env";
    try {
      expect([...resolveIgnoredDirNames(configPath)]).toStrictEqual(["from-config"]);
    } finally {
      delete process.env["CCP_WATCHER_IGNORED_DIRS"];
    }
  });

  it("falls back to defaults when config.json is malformed JSON", () => {
    writeFileSync(configPath, "{ not json");
    const resolved = resolveIgnoredDirNames(configPath);
    expect([...resolved].sort()).toStrictEqual([...__testing.DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("falls back to defaults when ignored_dirs is not an array", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: "node_modules" }));
    const resolved = resolveIgnoredDirNames(configPath);
    expect([...resolved].sort()).toStrictEqual([...__testing.DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("rejects the whole file and falls back to defaults when an array entry is invalid", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["keep", "", "  ", 42, null] }));
    const resolved = resolveIgnoredDirNames(configPath);
    expect([...resolved].sort()).toStrictEqual([...__testing.DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("rejects the whole file and falls back to defaults on unknown config keys", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["vendor"], bogus: true }));
    const resolved = resolveIgnoredDirNames(configPath);
    expect([...resolved].sort()).toStrictEqual([...__testing.DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("trims whitespace around valid configured directory names", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["  vendor  ", "tmp"] }));
    const resolved = readIgnoredDirsFromConfigViaTesting(configPath);
    expect(resolved).toStrictEqual(["vendor", "tmp"]);
  });

  function readIgnoredDirsFromConfigViaTesting(path: string): string[] | null {
    return __testing.readIgnoredDirsFromConfig(path);
  }
});

describe("shouldIgnoreWatch with configured ignored dirs", () => {
  const fileStats = {
    isFile: () => true,
    isDirectory: () => false,
  } as import("node:fs").Stats;
  const directoryStats = {
    isFile: () => false,
    isDirectory: () => true,
  } as import("node:fs").Stats;

  afterEach(() => {
    __testing.resetIgnoredDirPattern();
    __testing.setFileContentRoots([]);
  });

  it("honors a custom ignored-dir set when applied via the resolved pattern", () => {
    __testing.setIgnoredDirPattern(buildIgnoredDirPattern(new Set(["vendor", "tmp"])));

    expect(shouldIgnoreWatch("/foo/vendor/file.json")).toBe(true);
    expect(shouldIgnoreWatch("/foo/tmp/file.json")).toBe(true);
    // node_modules is no longer in the configured set.
    expect(shouldIgnoreWatch("/foo/node_modules/x.json", fileStats)).toBe(false);
  });

  it("escapes regex metacharacters in configured directory names", () => {
    __testing.setIgnoredDirPattern(buildIgnoredDirPattern(new Set([".cache", "a+b"])));

    expect(shouldIgnoreWatch("/foo/.cache/x")).toBe(true);
    expect(shouldIgnoreWatch("/foo/a+b/x")).toBe(true);
    // A literal '+' must not match as a regex quantifier.
    expect(shouldIgnoreWatch("/foo/aab/x.json", fileStats)).toBe(false);
  });

  it("watches searchable file extensions only inside configured file roots", () => {
    const fixtureDirectory = mkdtempSync(join(process.cwd(), "watcher-ignore-test-"));
    const fileContentRoot = join(fixtureDirectory, "allowed");
    mkdirSync(join(fileContentRoot, ".git"), { recursive: true });
    __testing.setFileContentRoots([fileContentRoot]);

    try {
      expect({
        ignoredBinary: shouldIgnoreWatch(join(fileContentRoot, "diagram.png"), fileStats),
        ignoredInsideRoot: shouldIgnoreWatch(join(fileContentRoot, "alice.custom"), fileStats),
        ignoredOutsideRoot: shouldIgnoreWatch(
          join(fixtureDirectory, "outside", "alice.custom"),
          fileStats,
        ),
        ignoredSourceMap: shouldIgnoreWatch(join(fileContentRoot, "bundle.js.map"), fileStats),
        ignoredSubtree: shouldIgnoreWatch(
          join(fileContentRoot, "node_modules", "alice.custom"),
          fileStats,
        ),
        ignoredGitConfig: shouldIgnoreWatch(join(fileContentRoot, ".git", "config"), fileStats),
        watchedGitDirectory: shouldIgnoreWatch(join(fileContentRoot, ".git"), directoryStats),
        watchedGitIndex: shouldIgnoreWatch(join(fileContentRoot, ".git", "index"), fileStats),
      }).toStrictEqual({
        ignoredBinary: true,
        ignoredInsideRoot: false,
        ignoredOutsideRoot: true,
        ignoredSourceMap: true,
        ignoredSubtree: true,
        ignoredGitConfig: true,
        watchedGitDirectory: false,
        watchedGitIndex: false,
      });
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});

describe("createWatcher resilience", () => {
  let dir: string;
  let server: Server | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "watcher-socket-test-"));
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not crash when a .git directory contains a Unix socket", async () => {
    const gitDir = join(dir, ".git");
    mkdirSync(gitDir, { recursive: true });
    const sockPath = join(gitDir, "fsmonitor--daemon.ipc");
    server = createServer();
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(sockPath, () => resolve());
    });

    const watcher = await createWatcher([dir]);
    const ready = new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
    await expect(ready).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 100));
    await watcher.close();
  });
});

describe("createWatcher integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a recursive watcher with the existing filter and handlers", async () => {
    const fixtureRoot = join(process.cwd(), ".llm");
    mkdirSync(fixtureRoot, { recursive: true });
    const fixtureDirectory = mkdtempSync(join(fixtureRoot, "watcher-integration-test-"));
    const watchedDirectory = join(fixtureDirectory, "watched");
    const fileContentRoot = join(fixtureDirectory, "file-content");
    mkdirSync(watchedDirectory);
    mkdirSync(join(fileContentRoot, ".git"), { recursive: true });
    let recursiveWatcher: RecursiveWatcher;
    const once = vi.fn((_event: "ready", _listener: () => void) => recursiveWatcher);
    const on = vi.fn(
      (_event: "add" | "change" | "unlink", _listener: (path: string) => void) => recursiveWatcher,
    );
    recursiveWatcher = {
      once,
      on,
      close: vi.fn(async () => undefined),
    } as unknown as RecursiveWatcher;
    const createRecursiveWatcher = vi
      .spyOn(recursiveWatch, "createRecursiveWatcher")
      .mockReturnValue(recursiveWatcher);

    try {
      const result = await createWatcher([watchedDirectory], undefined, undefined, undefined, [
        fileContentRoot,
      ]);

      expect({
        result,
        createCalls: createRecursiveWatcher.mock.calls,
        onCalls: on.mock.calls.map(([event, listener]) => [event, listener.name]),
      }).toStrictEqual({
        result: recursiveWatcher,
        createCalls: [[[watchedDirectory, fileContentRoot], shouldIgnoreWatch]],
        onCalls: [
          ["add", "handleFileChange"],
          ["change", "handleFileChange"],
          ["unlink", "handleFileUnlink"],
        ],
      });
    } finally {
      await recursiveWatcher.close();
      __testing.setFileContentRoots([]);
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("watches the real index directory for a linked worktree", async () => {
    const fixtureRoot = join(process.cwd(), ".llm");
    mkdirSync(fixtureRoot, { recursive: true });
    const fixtureDirectory = mkdtempSync(join(fixtureRoot, "watcher-worktree-test-"));
    const repositoryDirectory = join(fixtureDirectory, "repository");
    const worktreeDirectory = join(fixtureDirectory, "worktree");
    mkdirSync(repositoryDirectory);
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], {
      cwd: repositoryDirectory,
      stdio: "pipe",
    });
    const { repositoryIndexPath } = createLinkedWorktree(repositoryDirectory, fixtureDirectory);
    let recursiveWatcher: RecursiveWatcher;
    const once = vi.fn((_event: "ready", _listener: () => void) => recursiveWatcher);
    const on = vi.fn(
      (_event: "add" | "change" | "unlink", _listener: (path: string) => void) => recursiveWatcher,
    );
    recursiveWatcher = {
      once,
      on,
      close: vi.fn(async () => undefined),
    } as unknown as RecursiveWatcher;
    const createRecursiveWatcher = vi
      .spyOn(recursiveWatch, "createRecursiveWatcher")
      .mockReturnValue(recursiveWatcher);

    try {
      await createWatcher([], undefined, undefined, undefined, [worktreeDirectory]);

      expect(createRecursiveWatcher.mock.calls).toStrictEqual([
        [[worktreeDirectory, dirname(repositoryIndexPath)], shouldIgnoreWatch],
      ]);
    } finally {
      await recursiveWatcher.close();
      __testing.setFileContentRoots([]);
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});
