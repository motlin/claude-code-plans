import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const filesystemState = vi.hoisted(() => ({
  vanishedGitMarkers: new Set<string>(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: import("node:fs").PathLike) =>
      filesystemState.vanishedGitMarkers.has(path.toString()) || actual.existsSync(path),
  };
});

import { isGitRepository, listTrackedFiles, TrackedFileIndex } from "../src/lib/git-tracked";

describe("git-tracked", () => {
  let fixtureDirectory: string;
  let repositoryDirectory: string;

  function git(...arguments_: string[]): void {
    execFileSync("git", arguments_, { cwd: repositoryDirectory, stdio: "pipe" });
  }

  beforeEach(() => {
    const fixtureRoot = join(process.cwd(), ".llm");
    mkdirSync(fixtureRoot, { recursive: true });
    fixtureDirectory = mkdtempSync(join(fixtureRoot, "git-tracked-test-"));
    repositoryDirectory = join(fixtureDirectory, "repository");
    mkdirSync(repositoryDirectory);
    git("init", "--quiet", "--initial-branch=main");
  });

  afterEach(() => {
    filesystemState.vanishedGitMarkers.clear();
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it("detects repositories with directory and file git markers", () => {
    const worktreeDirectory = join(fixtureDirectory, "worktree");
    const plainDirectory = join(fixtureDirectory, "plain");
    mkdirSync(worktreeDirectory);
    mkdirSync(plainDirectory);
    writeFileSync(
      join(worktreeDirectory, ".git"),
      "gitdir: ../repository/.git/worktrees/example\n",
    );

    expect({
      repository: isGitRepository(repositoryDirectory),
      worktree: isGitRepository(worktreeDirectory),
      plain: isGitRepository(plainDirectory),
    }).toStrictEqual({
      repository: true,
      worktree: true,
      plain: false,
    });
  });

  it("returns false when a repository vanishes during inspection", () => {
    const vanishedDirectory = join(fixtureDirectory, "vanished");
    filesystemState.vanishedGitMarkers.add(join(vanishedDirectory, ".git"));

    expect(isGitRepository(vanishedDirectory)).toBe(false);
  });

  it("lists only tracked files as absolute paths", async () => {
    const trackedPath = join(repositoryDirectory, "tracked.txt");
    writeFileSync(trackedPath, "tracked\n");
    writeFileSync(join(repositoryDirectory, "untracked.txt"), "untracked\n");
    writeFileSync(join(repositoryDirectory, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(repositoryDirectory, "ignored.txt"), "ignored\n");
    git("add", "tracked.txt", ".gitignore");

    expect(await listTrackedFiles(repositoryDirectory)).toStrictEqual([
      join(repositoryDirectory, ".gitignore"),
      trackedPath,
    ]);
  });

  it("refreshes its tracked-file set after git add", async () => {
    const firstPath = join(repositoryDirectory, "first.txt");
    const secondPath = join(repositoryDirectory, "second.txt");
    writeFileSync(firstPath, "first\n");
    git("add", "first.txt");
    const index = new TrackedFileIndex(1);

    expect(await index.refresh(repositoryDirectory)).toStrictEqual(new Set([firstPath]));
    expect(index.has(repositoryDirectory, secondPath)).toBe(false);

    writeFileSync(secondPath, "second\n");
    git("add", "second.txt");

    expect(await index.refresh(repositoryDirectory)).toStrictEqual(
      new Set([firstPath, secondPath]),
    );
    expect(index.has(repositoryDirectory, secondPath)).toBe(true);
  });
});
