import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
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
import { DOMAIN_EVENTS } from "../src/lib/hook-events";
import { eq } from "drizzle-orm";
import type { SessionEntry } from "../src/lib/sessions";
import type { TaskRow } from "../src/lib/db/queries";

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
      state: "unknown",
      blockedSince: null,
    });
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
    const resolved = resolveIgnoredDirNames({}, missingPath);
    expect([...resolved].sort()).toStrictEqual([...__testing.DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("overrides defaults with the CCP_WATCHER_IGNORED_DIRS env var", () => {
    const resolved = resolveIgnoredDirNames(
      { CCP_WATCHER_IGNORED_DIRS: "foo, bar ,baz" },
      missingPath,
    );
    expect([...resolved].sort()).toStrictEqual(["bar", "baz", "foo"]);
  });

  it("ignores an empty CCP_WATCHER_IGNORED_DIRS and falls back to config", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["vendor"] }));
    const resolved = resolveIgnoredDirNames({ CCP_WATCHER_IGNORED_DIRS: "  ,  " }, configPath);
    expect([...resolved]).toStrictEqual(["vendor"]);
  });

  it("overrides defaults with the ignored_dirs array in config.json", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["vendor", "tmp"] }));
    const resolved = resolveIgnoredDirNames({}, configPath);
    expect([...resolved].sort()).toStrictEqual(["tmp", "vendor"]);
  });

  it("prefers the env var over config.json when both are present", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["from-config"] }));
    const resolved = resolveIgnoredDirNames({ CCP_WATCHER_IGNORED_DIRS: "from-env" }, configPath);
    expect([...resolved]).toStrictEqual(["from-env"]);
  });

  it("falls back to defaults when config.json is malformed JSON", () => {
    writeFileSync(configPath, "{ not json");
    const resolved = resolveIgnoredDirNames({}, configPath);
    expect([...resolved].sort()).toStrictEqual([...__testing.DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("falls back to defaults when ignored_dirs is not an array", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: "node_modules" }));
    const resolved = resolveIgnoredDirNames({}, configPath);
    expect([...resolved].sort()).toStrictEqual([...__testing.DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("rejects the whole file and falls back to defaults when an array entry is invalid", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["keep", "", "  ", 42, null] }));
    const resolved = resolveIgnoredDirNames({}, configPath);
    expect([...resolved].sort()).toStrictEqual([...__testing.DEFAULT_IGNORED_DIR_NAMES].sort());
  });

  it("rejects the whole file and falls back to defaults on unknown config keys", () => {
    writeFileSync(configPath, JSON.stringify({ ignored_dirs: ["vendor"], bogus: true }));
    const resolved = resolveIgnoredDirNames({}, configPath);
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

  it("watches every regular-file extension only inside configured file roots", () => {
    __testing.setFileContentRoots(["/tmp/test/allowed"]);

    expect({
      ignoredInsideRoot: shouldIgnoreWatch("/tmp/test/allowed/alice.custom", fileStats),
      ignoredOutsideRoot: shouldIgnoreWatch("/tmp/test/outside/alice.custom", fileStats),
      ignoredSubtree: shouldIgnoreWatch("/tmp/test/allowed/node_modules/alice.custom", fileStats),
    }).toStrictEqual({
      ignoredInsideRoot: false,
      ignoredOutsideRoot: true,
      ignoredSubtree: true,
    });
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

  it("boots without EMFILE when the watched tree has thousands of directories", async () => {
    // fs.watch on macOS hits EMFILE around 5k watched directories; verify
    // createWatcher survives a tree well past that limit (the real plugin
    // cache holds 100k+ files spread across ~5k dirs).
    for (let i = 0; i < 6000; i++) {
      mkdirSync(join(dir, `d${i}`));
    }
    const watcher = await createWatcher([dir]);
    const errors: unknown[] = [];
    watcher.on("error", (err) => errors.push(err));
    await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
    await watcher.close();
    expect(errors).toStrictEqual([]);
  }, 30_000);

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
    const errors: unknown[] = [];
    watcher.on("error", (err) => errors.push(err));
    await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
    // Let any deferred errors land before asserting.
    await new Promise((r) => setTimeout(r, 100));
    await watcher.close();

    expect(errors).toStrictEqual([]);
  });
});
