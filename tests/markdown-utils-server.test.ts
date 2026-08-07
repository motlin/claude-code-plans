import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractTitle,
  extractTitleFromContent,
  humanizeFilename,
} from "../src/lib/markdown-utils.server.js";

const testDirectory = join(tmpdir(), `claude-markdown-utils-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(testDirectory, { recursive: true });
});

afterEach(() => {
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("extractTitle", () => {
  it("re-exports the pure title helpers", () => {
    expect([
      extractTitleFromContent("# Alice's Plan", "alice-plan.md"),
      humanizeFilename("alice-plan.md"),
    ]).toStrictEqual(["Alice's Plan", "Alice Plan"]);
  });

  it("reads a title from a file", async () => {
    writeFileSync(join(testDirectory, "alice-plan.md"), "# Alice's Plan\n\nBody");

    expect(await extractTitle(join(testDirectory, "alice-plan.md"), "alice-plan.md")).toBe(
      "Alice's Plan",
    );
  });

  it("falls back for a missing file", async () => {
    expect(await extractTitle(join(testDirectory, "missing.md"), "alice-plan.md")).toBe(
      "Alice Plan",
    );
  });
});
