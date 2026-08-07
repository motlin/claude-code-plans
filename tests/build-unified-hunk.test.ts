import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DiffFile } from "@git-diff-view/core";
import { buildUnifiedHunk } from "../src/lib/diff-utils.js";

function parseHunk(hunk: string): { header: string; body: string[] } {
  const lines = hunk.split("\n");
  const headerIndex = lines.findIndex((line) => line.startsWith("@@"));
  return { header: lines[headerIndex]!, body: lines.slice(headerIndex + 1) };
}

function reconstruct(body: string[]): { old: string[]; next: string[] } {
  const old: string[] = [];
  const next: string[] = [];
  for (const line of body) {
    const marker = line[0];
    const text = line.slice(1);
    if (marker === " ") {
      old.push(text);
      next.push(text);
    } else if (marker === "-") {
      old.push(text);
    } else if (marker === "+") {
      next.push(text);
    }
  }
  return { old, next };
}

/**
 * `@git-diff-view/core` cross-checks `oldFileContent`/`newFileContent` against the
 * supplied hunk and warns on any mismatch, but only when NODE_ENV is "development".
 * Collect those warnings the way a dev-server browser session would surface them.
 */
function collectDiffViewWarnings(oldStr: string, newStr: string, filePath: string): string[] {
  const warnings: string[] = [];
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(" "));
  });
  vi.stubEnv("NODE_ENV", "development");
  try {
    const diffFile = new DiffFile(
      filePath,
      oldStr,
      filePath,
      newStr,
      [buildUnifiedHunk(oldStr, newStr, filePath)],
      "text",
      "text",
    );
    diffFile.init();
    diffFile.buildSplitDiffLines();
    diffFile.buildUnifiedDiffLines();
  } finally {
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
  }
  return warnings;
}

describe("buildUnifiedHunk", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the git new-file convention when the old side is empty", () => {
    const { header, body } = parseHunk(buildUnifiedHunk("", "alpha\nbeta\n", "notes.md"));
    expect({ header, markers: [...new Set(body.map((line) => line[0]))] }).toStrictEqual({
      header: "@@ -0,0 +1,3 @@",
      markers: ["+"],
    });
  });

  it("uses the git deleted-file convention when the new side is empty", () => {
    const { header, body } = parseHunk(buildUnifiedHunk("alpha\nbeta", "", "notes.md"));
    expect({ header, markers: [...new Set(body.map((line) => line[0]))] }).toStrictEqual({
      header: "@@ -1,2 +0,0 @@",
      markers: ["-"],
    });
  });

  it("keeps 1-based counts and reconstructable content for a normal edit", () => {
    const oldStr = "one\ntwo\nthree";
    const newStr = "one\ntwo-changed\nthree";
    const { header, body } = parseHunk(buildUnifiedHunk(oldStr, newStr, "file.ts"));
    expect({ header, ...reconstruct(body) }).toStrictEqual({
      header: "@@ -1,3 +1,3 @@",
      old: oldStr.split("\n"),
      next: newStr.split("\n"),
    });
  });

  it("emits an empty hunk when both sides are empty", () => {
    const { header, body } = parseHunk(buildUnifiedHunk("", "", "file.ts"));
    expect({ header, body }).toStrictEqual({ header: "@@ -0,0 +0,0 @@", body: [] });
  });

  it("does not make @git-diff-view/core warn when a Write creates a new file", () => {
    expect(collectDiffViewWarnings("", "# Title\n\nBody text\n", "plan.md")).toStrictEqual([]);
  });

  it("does not make @git-diff-view/core warn for an Edit fragment", () => {
    expect(
      collectDiffViewWarnings("const a = 1;\nconst b = 2;", "const a = 1;\nconst b = 3;", "a.ts"),
    ).toStrictEqual([]);
  });
});
