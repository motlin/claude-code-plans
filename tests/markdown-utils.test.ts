import {
  humanizeFilename,
  extractTitleFromContent,
  stripLeadingTitleHeading,
} from "../src/lib/markdown-utils.js";

describe("humanizeFilename", () => {
  it("converts dashes and underscores to title case", () => {
    expect(humanizeFilename("my-cool-plan.md")).toBe("My Cool Plan");
  });

  it("strips .md extension", () => {
    expect(humanizeFilename("readme.md")).toBe("Readme");
  });
});

describe("extractTitleFromContent", () => {
  it("extracts title from # heading", () => {
    expect(extractTitleFromContent("# My Title\n\nContent", "file.md")).toBe("My Title");
  });

  it("falls back to humanized filename", () => {
    expect(extractTitleFromContent("No heading here", "my-file.md")).toBe("My File");
  });

  it("falls back for empty content", () => {
    expect(extractTitleFromContent("", "fallback.md")).toBe("Fallback");
  });
});

describe("stripLeadingTitleHeading", () => {
  it("strips H1 line and a single trailing blank line", () => {
    expect(stripLeadingTitleHeading("# Title\n\nBody")).toBe("Body");
  });

  it("strips H1 line when no trailing blank line follows", () => {
    expect(stripLeadingTitleHeading("# Title\nBody")).toBe("Body");
  });

  it("returns empty string when input is only an H1", () => {
    expect(stripLeadingTitleHeading("# Title")).toBe("");
  });

  it("does not strip level-2 headings", () => {
    expect(stripLeadingTitleHeading("## Sub")).toBe("## Sub");
  });

  it("passes through content with no H1", () => {
    expect(stripLeadingTitleHeading("No heading")).toBe("No heading");
  });

  it("passes through empty input", () => {
    expect(stripLeadingTitleHeading("")).toBe("");
  });
});
