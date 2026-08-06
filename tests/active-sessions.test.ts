import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tests for `scanActiveSessions()` in `src/lib/active-sessions.ts`, which unions
 * the hook-driven in-memory store with a filesystem mtime scan of
 * `~/.claude/projects/<encodedDir>/<sessionId>.jsonl`.
 *
 * The scan reads `homedir()` at call time, so each test mocks `node:os` to point
 * at an isolated temp home and mocks `resolveProjectName` to a deterministic
 * decode (encoded dir -> last path segment). Modules are reset per test so the
 * store starts empty and the mocks apply before `active-sessions` is imported.
 */

let tempHome: string;
let pendingApprovals: Array<{ sessionId: string; blockedSince: string }>;

/** Encode a cwd into the `~/.claude/projects` directory-name form. */
function encode(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

function projectsDir(): string {
  return join(tempHome, ".claude", "projects");
}

/** Create `<projects>/<encoded(cwd)>/<sessionId>.jsonl` with the given mtime. */
function writeSessionFile(cwd: string, sessionId: string, mtime: Date): string {
  const dir = join(projectsDir(), encode(cwd));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, "{}\n");
  utimesSync(file, mtime, mtime);
  return file;
}

async function loadModules() {
  vi.resetModules();
  vi.doMock("node:os", async () => {
    const actual = await vi.importActual<typeof import("node:os")>("node:os");
    return { ...actual, homedir: () => tempHome };
  });
  vi.doMock("../src/lib/memory", async () => {
    const actual = await vi.importActual<typeof import("../src/lib/memory")>("../src/lib/memory");
    return {
      ...actual,
      // Deterministic decode: "-Users-test-alpha" -> "alpha".
      resolveProjectName: async (encoded: string): Promise<string> => {
        const decoded = "/" + encoded.slice(1).replace(/-/g, "/");
        const segments = decoded.split("/");
        return segments[segments.length - 1]!;
      },
    };
  });
  vi.doMock("../src/lib/db/pending-approvals-cache", () => ({
    getPendingApprovals: () => pendingApprovals,
  }));
  const scanMod = await import("../src/lib/active-sessions");
  const storeMod = await import("../src/lib/active-session-store");
  return { scanMod, storeMod };
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "active-sessions-test-"));
  pendingApprovals = [];
  mkdirSync(projectsDir(), { recursive: true });
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  vi.doUnmock("node:os");
  vi.doUnmock("../src/lib/memory");
  vi.doUnmock("../src/lib/db/pending-approvals-cache");
  vi.resetModules();
});

describe("scanActiveSessions", () => {
  it("shows a filesystem-only session modified within the active window", async () => {
    const file = writeSessionFile("/Users/test/alpha", "fs-only", new Date(Date.now() - 60_000));
    const { scanMod } = await loadModules();

    const result = await scanMod.scanActiveSessions();

    expect(result).toStrictEqual([
      {
        sessionId: "fs-only",
        projectDir: encode("/Users/test/alpha"),
        projectName: "alpha",
        createdAt: statSync(file).birthtimeMs,
        lastModified: statSync(file).mtimeMs,
        state: "unknown",
        blockedSince: null,
      },
    ]);
  });

  it("excludes a filesystem session older than the active window", async () => {
    writeSessionFile("/Users/test/alpha", "stale", new Date(Date.now() - 6 * 60_000));
    const { scanMod } = await loadModules();

    const result = await scanMod.scanActiveSessions();

    expect(result).toStrictEqual([]);
  });

  it("dedups a session present in both sources, preferring the fresher lastModified", async () => {
    const file = writeSessionFile("/Users/test/alpha", "shared", new Date(Date.now() - 10_000));
    const { scanMod, storeMod } = await loadModules();

    storeMod.markSessionActive("shared", { cwd: "/Users/test/alpha" });
    storeMod.setSessionState("shared", "working");
    // Make the store entry older than the filesystem file so the fs mtime wins.
    const entry = storeMod.getActiveSessionEntries().find((e) => e.sessionId === "shared")!;
    entry.lastActivity = Date.now() - 60_000;

    const result = await scanMod.scanActiveSessions();

    expect(result).toStrictEqual([
      {
        sessionId: "shared",
        projectDir: encode("/Users/test/alpha"),
        projectName: "alpha",
        createdAt: Math.min(entry.startedAt, statSync(file).birthtimeMs),
        lastModified: statSync(file).mtimeMs,
        state: "working",
        blockedSince: null,
      },
    ]);
  });

  it("surfaces a store-only session alongside a filesystem-only one", async () => {
    writeSessionFile("/Users/test/alpha", "fs-only", new Date(Date.now() - 30_000));
    // beta has no jsonl file; findProjectDirForCwd only needs the dir to exist.
    mkdirSync(join(projectsDir(), encode("/Users/test/beta")), { recursive: true });
    const { scanMod, storeMod } = await loadModules();

    storeMod.markSessionActive("store-only", { cwd: "/Users/test/beta" });

    const result = await scanMod.scanActiveSessions();

    expect(result.map((r) => r.sessionId).sort()).toStrictEqual(["fs-only", "store-only"]);
    const byId = new Map(result.map((r) => [r.sessionId, r]));
    expect(byId.get("fs-only")!.projectName).toBe("alpha");
    expect(byId.get("store-only")!.projectName).toBe("beta");
  });

  it("prefers durable pending-approval state and exposes its blocked-since clock", async () => {
    writeSessionFile("/Users/test/alpha", "waiting", new Date(Date.now() - 30_000));
    pendingApprovals = [{ sessionId: "waiting", blockedSince: "2000-01-01T00:00:00.000Z" }];
    const { scanMod } = await loadModules();

    const result = await scanMod.scanActiveSessions();

    expect(result[0]).toMatchObject({
      sessionId: "waiting",
      state: "waiting",
      blockedSince: "2000-01-01T00:00:00.000Z",
    });
  });
});
