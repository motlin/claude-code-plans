import { writeFileSync, mkdirSync, rmSync, utimesSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  decodeProjectDir,
  encodeProjectPath,
  listMemories,
  readMemory,
  writeMemory,
  deleteMemory,
  getProjectsDir,
  resolveProjectName,
} from "../src/lib/memory.js";

const testDir = join(tmpdir(), "claude-memory-test-" + process.pid);

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("encodeProjectPath", () => {
  it("collapses path punctuation to hyphens", () => {
    expect(["/", ".", "_", "-"].map(encodeProjectPath)).toStrictEqual(["-", "-", "-", "-"]);
  });
});

describe("decodeProjectDir", () => {
  it("returns the final encoded segment when no projectPath is available", () => {
    expect(decodeProjectDir("-Users-craig-projects-myapp")).toBe("myapp");
  });

  it("skips empty segments introduced by punctuation", () => {
    expect(decodeProjectDir("-Users-craig--dotfiles")).toBe("dotfiles");
  });

  it("uses last segment of projectPath when provided", () => {
    expect(decodeProjectDir("-Users-craig-projects-my-app", "/Users/craig/projects/my-app")).toBe(
      "my-app",
    );
  });
});

describe("resolveProjectName", () => {
  it("uses a short fallback when the project directory no longer exists", async () => {
    const names = await Promise.all([
      resolveProjectName("-Users-craig--dotfiles"),
      resolveProjectName(
        "-Users-craig-projects-factorio-blueprint-playground--llm-worktrees-transformations-codex",
      ),
      resolveProjectName("-Users-craig-projects-klass-fix-739-rewrite-per-rule"),
    ]);

    expect(names).toStrictEqual(["dotfiles", "codex", "rule"]);
    expect(names.every((name) => !name.startsWith("/Users/"))).toBe(true);
  });
});

describe("listMemories", () => {
  it("returns empty array when no project dirs exist", async () => {
    const groups = await listMemories(testDir);
    expect(groups).toStrictEqual([]);
  });

  it("returns empty array when directory does not exist", async () => {
    const groups = await listMemories(join(testDir, "nonexistent"));
    expect(groups).toStrictEqual([]);
  });

  it("lists memory files grouped by project", async () => {
    const projectDir = join(testDir, "-Users-craig-projects-app");
    const memDir = join(projectDir, "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "MEMORY.md"), "# Memory\n\nSome notes");
    writeFileSync(join(memDir, "patterns.md"), "# Patterns\n\nSome patterns");

    const groups = await listMemories(testDir);
    if (groups.length !== 1) throw new Error(`Expected 1 group, got ${groups.length}`);
    expect(groups[0]!.project).toBe("-Users-craig-projects-app");
    expect(groups[0]!.projectName).toBe("app");
    expect(groups[0]!.memories.map((m) => m.filename).sort()).toStrictEqual([
      "MEMORY.md",
      "patterns.md",
    ]);
  });

  it("skips projects without memory directories", async () => {
    mkdirSync(join(testDir, "-Users-craig-projects-no-memory"), {
      recursive: true,
    });

    const groups = await listMemories(testDir);
    expect(groups).toStrictEqual([]);
  });

  it("skips non-md files in memory dirs", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "MEMORY.md"), "# Memory");
    writeFileSync(join(memDir, "notes.txt"), "not markdown");

    const groups = await listMemories(testDir);
    expect(groups[0]!.memories.map((m) => m.filename)).toStrictEqual(["MEMORY.md"]);
  });

  it("sorts groups by most recent mtime", async () => {
    const olderMemDir = join(testDir, "-Users-craig-projects-older", "memory");
    const newerMemDir = join(testDir, "-Users-craig-projects-newer", "memory");
    mkdirSync(olderMemDir, { recursive: true });
    mkdirSync(newerMemDir, { recursive: true });

    writeFileSync(join(olderMemDir, "MEMORY.md"), "# Older");
    writeFileSync(join(newerMemDir, "MEMORY.md"), "# Newer");

    const pastTime = new Date(Date.now() - 60000);
    utimesSync(join(olderMemDir, "MEMORY.md"), pastTime, pastTime);

    const groups = await listMemories(testDir);
    expect(groups.map((g) => g.project)).toStrictEqual([
      "-Users-craig-projects-newer",
      "-Users-craig-projects-older",
    ]);
  });

  it("extracts title from # heading", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "patterns.md"), "# Coding Patterns\n\nContent");

    const groups = await listMemories(testDir);
    expect(groups[0]!.memories[0]!.title).toBe("Coding Patterns");
  });

  it("falls back to humanized filename when no heading", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "debug-notes.md"), "No heading here");

    const groups = await listMemories(testDir);
    expect(groups[0]!.memories[0]!.title).toBe("Debug Notes");
  });
});

describe("readMemory", () => {
  it("reads a valid memory file", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "MEMORY.md"), "# Memory\n\nContent");

    const content = await readMemory(testDir, "-Users-craig-projects-app", "MEMORY.md");
    expect(content).toBe("# Memory\n\nContent");
  });

  it("returns null for non-existent file", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });

    const content = await readMemory(testDir, "-Users-craig-projects-app", "nope.md");
    expect(content).toBe(null);
  });

  it("rejects path traversal in project param", async () => {
    const content = await readMemory(testDir, "../etc", "passwd.md");
    expect(content).toBe(null);
  });

  it("rejects path traversal in filename param", async () => {
    const content = await readMemory(testDir, "-Users-craig-projects-app", "../../../etc/passwd");
    expect(content).toBe(null);
  });

  it("rejects slash in filename", async () => {
    const content = await readMemory(testDir, "-Users-craig-projects-app", "sub/file.md");
    expect(content).toBe(null);
  });

  it("rejects non-md extension", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "secret.txt"), "secret");

    const content = await readMemory(testDir, "-Users-craig-projects-app", "secret.txt");
    expect(content).toBe(null);
  });

  it("rejects slash in project param", async () => {
    const content = await readMemory(testDir, "foo/bar", "MEMORY.md");
    expect(content).toBe(null);
  });
});

describe("writeMemory", () => {
  it("writes content to a memory file", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });

    const ok = await writeMemory(
      testDir,
      "-Users-craig-projects-app",
      "notes.md",
      "# Notes\n\nContent",
    );
    expect(ok).toBe(true);
    const written = readFileSync(join(memDir, "notes.md"), "utf-8");
    expect(written).toBe("# Notes\n\nContent");
  });

  it("overwrites an existing memory file", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "MEMORY.md"), "# Old");

    const ok = await writeMemory(testDir, "-Users-craig-projects-app", "MEMORY.md", "# Updated");
    expect(ok).toBe(true);
    const written = readFileSync(join(memDir, "MEMORY.md"), "utf-8");
    expect(written).toBe("# Updated");
  });

  it("rejects path traversal in project param", async () => {
    const ok = await writeMemory(testDir, "../etc", "file.md", "bad");
    expect(ok).toBe(false);
  });

  it("rejects path traversal in filename param", async () => {
    const ok = await writeMemory(
      testDir,
      "-Users-craig-projects-app",
      "../../../etc/passwd.md",
      "bad",
    );
    expect(ok).toBe(false);
  });

  it("rejects slash in project param", async () => {
    const ok = await writeMemory(testDir, "foo/bar", "file.md", "bad");
    expect(ok).toBe(false);
  });

  it("rejects slash in filename", async () => {
    const ok = await writeMemory(testDir, "-Users-craig-projects-app", "sub/file.md", "bad");
    expect(ok).toBe(false);
  });

  it("rejects non-md extension", async () => {
    const ok = await writeMemory(testDir, "-Users-craig-projects-app", "file.txt", "bad");
    expect(ok).toBe(false);
  });
});

describe("deleteMemory", () => {
  it("deletes an existing memory file", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "notes.md"), "# Notes\n\nContent");

    const ok = await deleteMemory(testDir, "-Users-craig-projects-app", "notes.md");
    expect(ok).toBe(true);
    expect(existsSync(join(memDir, "notes.md"))).toBe(false);
  });

  it("returns false for non-existent file", async () => {
    const memDir = join(testDir, "-Users-craig-projects-app", "memory");
    mkdirSync(memDir, { recursive: true });

    const ok = await deleteMemory(testDir, "-Users-craig-projects-app", "nope.md");
    expect(ok).toBe(false);
  });

  it("rejects path traversal in project param", async () => {
    const ok = await deleteMemory(testDir, "../etc", "file.md");
    expect(ok).toBe(false);
  });

  it("rejects path traversal in filename param", async () => {
    const ok = await deleteMemory(testDir, "-Users-craig-projects-app", "../../../etc/passwd.md");
    expect(ok).toBe(false);
  });

  it("rejects slash in project param", async () => {
    const ok = await deleteMemory(testDir, "foo/bar", "file.md");
    expect(ok).toBe(false);
  });

  it("rejects slash in filename", async () => {
    const ok = await deleteMemory(testDir, "-Users-craig-projects-app", "sub/file.md");
    expect(ok).toBe(false);
  });

  it("rejects non-md extension", async () => {
    const ok = await deleteMemory(testDir, "-Users-craig-projects-app", "file.txt");
    expect(ok).toBe(false);
  });
});

describe("getProjectsDir", () => {
  it("returns path under ~/.claude/projects", () => {
    const dir = getProjectsDir();
    expect(dir).toBe(join(homedir(), ".claude", "projects"));
  });
});
