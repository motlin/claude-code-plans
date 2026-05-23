import { computeDiffData, extractLineNumbers } from "../src/lib/diff-utils.js";

describe("computeDiffData", () => {
  it("counts added and removed lines", () => {
    const result = computeDiffData("line1\nline2\nline3", "new1\nnew2");
    expect(result.added).toBe(2);
    expect(result.removed).toBe(3);
  });

  it("identifies context lines for shared content", () => {
    const result = computeDiffData(
      'import a from "a";\nimport b from "b";',
      'import a from "a";\nimport b from "b";\nimport c from "c";',
    );
    const contextCount = result.ops.filter(([type]) => type === "equal").length;
    const addedCount = result.ops.filter(([type]) => type === "add").length;
    expect(contextCount).toBe(2);
    expect(addedCount).toBe(1);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
  });

  it("handles single-line edits", () => {
    const result = computeDiffData("old", "new");
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
  });

  it("handles pure addition (empty old string)", () => {
    const result = computeDiffData("", "new line");
    expect(result.added).toBeGreaterThanOrEqual(1);
  });

  it("handles pure deletion (empty new string)", () => {
    const result = computeDiffData("deleted line", "");
    expect(result.removed).toBeGreaterThanOrEqual(1);
  });

  it("handles both strings empty", () => {
    const result = computeDiffData("", "");
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.ops.length).toBe(1); // one equal empty string
  });

  it("interleaves removed and added lines correctly", () => {
    const result = computeDiffData("line1\nold-line\nline3", "line1\nnew-line\nline3");
    const contextCount = result.ops.filter(([type]) => type === "equal").length;
    const removedCount = result.ops.filter(([type]) => type === "remove").length;
    const addedCount = result.ops.filter(([type]) => type === "add").length;
    expect(contextCount).toBe(2);
    expect(removedCount).toBe(1);
    expect(addedCount).toBe(1);
  });

  it("returns ops in correct order", () => {
    const result = computeDiffData("a\nb", "a\nc");
    expect(result.ops[0]).toStrictEqual(["equal", "a"]);
    expect(result.ops[1]).toStrictEqual(["remove", "b"]);
    expect(result.ops[2]).toStrictEqual(["add", "c"]);
  });
});

describe("extractLineNumbers", () => {
  it("extracts line numbers from arrow prefix", () => {
    const result = extractLineNumbers("1→const x = 1;\n2→const y = 2;");
    expect(result.text).toBe("const x = 1;\nconst y = 2;");
    expect(result.startLine).toBe(1);
  });

  it("preserves startLine when starting from non-1", () => {
    const result = extractLineNumbers("42→line 42\n43→line 43");
    expect(result.text).toBe("line 42\nline 43");
    expect(result.startLine).toBe(42);
  });

  it("handles tab separator between line number and content", () => {
    const result = extractLineNumbers("1\tconst x = 1;\n2\tconst y = 2;");
    expect(result.text).toBe("const x = 1;\nconst y = 2;");
    expect(result.startLine).toBe(1);
  });

  it("handles mixed whitespace before line number", () => {
    const result = extractLineNumbers("  1→content\n  2→more content");
    expect(result.text).toBe("content\nmore content");
    expect(result.startLine).toBe(1);
  });

  it("returns startLine 1 when no line numbers found", () => {
    const result = extractLineNumbers("no line number\nhere either");
    expect(result.text).toBe("no line number\nhere either");
    expect(result.startLine).toBe(1);
  });

  it("handles text with line numbers in the middle", () => {
    const result = extractLineNumbers("regular line\n5→numbered line\n6→another numbered");
    expect(result.text).toBe("regular line\nnumbered line\nanother numbered");
    expect(result.startLine).toBe(1); // starts with non-numbered line
  });

  it("handles empty input", () => {
    const result = extractLineNumbers("");
    expect(result.text).toBe("");
    expect(result.startLine).toBe(1);
  });
});
