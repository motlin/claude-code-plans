import { describe, it, expect } from "vite-plus/test";
import { mdFileHref, resolveRelativeMdHref } from "../src/lib/md-links";

describe("mdFileHref", () => {
  it("drops the .md extension so the href matches the slug-based route", () => {
    expect(mdFileHref("/memory/-Users-craig-projects-kalshi", "always-work-in-worktree.md")).toBe(
      "/memory/-Users-craig-projects-kalshi/always-work-in-worktree",
    );
  });

  it("accepts a bare name that already lacks the extension", () => {
    expect(mdFileHref("/memory/proj", "always-work-in-worktree")).toBe(
      "/memory/proj/always-work-in-worktree",
    );
  });

  it("percent-encodes characters that would otherwise split the path", () => {
    expect(mdFileHref("/memory/proj", "notes/on spaces.md")).toBe(
      "/memory/proj/notes%2Fon%20spaces",
    );
  });
});

describe("resolveRelativeMdHref", () => {
  it("rewrites a sibling .md link to the in-app route", () => {
    expect(resolveRelativeMdHref("always-work-in-worktree.md", "/memory/proj")).toBe(
      "/memory/proj/always-work-in-worktree",
    );
  });

  it("rewrites an explicitly current-directory link", () => {
    expect(resolveRelativeMdHref("./always-work-in-worktree.md", "/memory/proj")).toBe(
      "/memory/proj/always-work-in-worktree",
    );
  });

  it("preserves a trailing fragment", () => {
    expect(resolveRelativeMdHref("notes.md#gotchas", "/memory/proj")).toBe(
      "/memory/proj/notes#gotchas",
    );
  });

  it("leaves absolute and non-markdown links alone", () => {
    expect([
      resolveRelativeMdHref("https://example.com/notes.md", "/memory/proj"),
      resolveRelativeMdHref("http://example.com/notes.md", "/memory/proj"),
      resolveRelativeMdHref("//example.com/notes.md", "/memory/proj"),
      resolveRelativeMdHref("mailto:someone@example.md", "/memory/proj"),
      resolveRelativeMdHref("/memories", "/memory/proj"),
      resolveRelativeMdHref("#section", "/memory/proj"),
      resolveRelativeMdHref("notes.txt", "/memory/proj"),
      resolveRelativeMdHref("", "/memory/proj"),
    ]).toStrictEqual([null, null, null, null, null, null, null, null]);
  });

  it("leaves links that escape the flat memory directory alone", () => {
    expect([
      resolveRelativeMdHref("../other/notes.md", "/memory/proj"),
      resolveRelativeMdHref("sub/notes.md", "/memory/proj"),
      resolveRelativeMdHref("notes.md?raw=1", "/memory/proj"),
    ]).toStrictEqual([null, null, null]);
  });
});
