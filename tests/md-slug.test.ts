import { describe, it, expect } from "vite-plus/test";
import { toMdSlug, fromMdSlug } from "../src/lib/md-slug";

describe("toMdSlug / fromMdSlug", () => {
  it("strips a trailing .md to form a URL slug", () => {
    expect(toMdSlug("2026-06-07-fix-thing.md")).toBe("2026-06-07-fix-thing");
  });

  it("re-adds .md to recover the on-disk filename", () => {
    expect(fromMdSlug("2026-06-07-fix-thing")).toBe("2026-06-07-fix-thing.md");
  });

  it("round-trips a real timestamped plan name", () => {
    const filename = "08-40-31-787-installhook-js-1-error-fail-enchanted-stream.md";
    expect(fromMdSlug(toMdSlug(filename))).toBe(filename);
  });

  it("strips only the final .md, leaving dots inside the basename intact", () => {
    expect(toMdSlug("v1.2.3-notes.md")).toBe("v1.2.3-notes");
    expect(fromMdSlug("v1.2.3-notes")).toBe("v1.2.3-notes.md");
  });
});
