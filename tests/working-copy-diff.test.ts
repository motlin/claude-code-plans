import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildWorkingCopyDiff } from "../src/lib/working-copy-diff";

describe("buildWorkingCopyDiff", () => {
  let repositoryDirectory: string;

  function git(...arguments_: string[]): void {
    execFileSync("git", arguments_, { cwd: repositoryDirectory, stdio: "pipe" });
  }

  beforeEach(() => {
    const fixtureRoot = join(process.cwd(), ".llm");
    mkdirSync(fixtureRoot, { recursive: true });
    repositoryDirectory = mkdtempSync(join(fixtureRoot, "working-copy-diff-test-"));

    git("init", "--initial-branch=main");
    git("config", "user.email", "alice@example.com");
    git("config", "user.name", "Alice");
    git("config", "diff.mnemonicPrefix", "false");
    writeFileSync(join(repositoryDirectory, "modified.txt"), "before modification\n");
    writeFileSync(join(repositoryDirectory, "staged.txt"), "before staging\n");
    git("add", "modified.txt", "staged.txt");
    git("commit", "--message", "Create fixture files.");
  });

  afterEach(() => {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  });

  it("includes modified tracked, staged, and untracked files", async () => {
    writeFileSync(join(repositoryDirectory, "modified.txt"), "after modification\n");
    writeFileSync(join(repositoryDirectory, "staged.txt"), "after staging\n");
    git("add", "staged.txt");
    writeFileSync(join(repositoryDirectory, "untracked\nnotes.txt"), "untracked content\n");

    const diff = await buildWorkingCopyDiff(repositoryDirectory);
    const normalizedDiff = diff.replace(/^index .+$/gm, "index <hashes>");

    expect(normalizedDiff).toBe(
      [
        "diff --git a/modified.txt b/modified.txt",
        "index <hashes>",
        "--- a/modified.txt",
        "+++ b/modified.txt",
        "@@ -1 +1 @@",
        "-before modification",
        "+after modification",
        "diff --git a/staged.txt b/staged.txt",
        "index <hashes>",
        "--- a/staged.txt",
        "+++ b/staged.txt",
        "@@ -1 +1 @@",
        "-before staging",
        "+after staging",
        "",
        'diff --git "a/untracked\\nnotes.txt" "b/untracked\\nnotes.txt"',
        "new file mode 100644",
        "index <hashes>",
        "--- /dev/null",
        '+++ "b/untracked\\nnotes.txt"',
        "@@ -0,0 +1 @@",
        "+untracked content",
        "",
      ].join("\n"),
    );
  });
});
