import type { HighlighterCore } from "@shikijs/core";
import {
  renderMarkdownToHtml,
  renderMarkdownWithHighlighting,
  looksLikeMarkdown,
} from "../src/lib/client-markdown";

describe("looksLikeMarkdown", () => {
  it("returns true for text with 2+ markdown indicators", () => {
    // heading + bullet list
    expect(looksLikeMarkdown("# Title\n- item 1\n- item 2")).toBe(true);
    // bold + link
    expect(looksLikeMarkdown("**bold text** and [a link](http://example.com)")).toBe(true);
    // code fence + heading
    expect(looksLikeMarkdown("# Code\n```\nconst x = 1;\n```")).toBe(true);
    // bullet list + bold
    expect(looksLikeMarkdown("- **bold item**\n- another item")).toBe(true);
  });

  it("returns false for text with fewer than 2 indicators", () => {
    // just a bullet list (1 indicator)
    expect(looksLikeMarkdown("- item 1\n- item 2\n- item 3")).toBe(false);
    // just a heading (1 indicator)
    expect(looksLikeMarkdown("# Title\nSome plain text here")).toBe(false);
    // plain text (0 indicators)
    expect(looksLikeMarkdown("Just some regular text on multiple lines\nMore text here")).toBe(
      false,
    );
  });

  it("returns false for empty or whitespace text", () => {
    expect(looksLikeMarkdown("")).toBe(false);
    expect(looksLikeMarkdown("   ")).toBe(false);
  });

  it("detects computer tool results with markdown formatting", () => {
    // Typical claude-in-chrome computer tool result with markdown
    const computerResult = `## Page Content

The page shows:
- **Navigation bar** at the top
- A search input field
- [Documentation link](https://docs.example.com)`;
    expect(looksLikeMarkdown(computerResult)).toBe(true);
  });
});

describe("renderMarkdownToHtml", () => {
  it("renders markdown headings to HTML", () => {
    const result = renderMarkdownToHtml("# Hello");
    expect(result).toContain("<h1>Hello</h1>");
  });

  it("renders empty/whitespace-only input as empty string", () => {
    expect(renderMarkdownToHtml("")).toBe("");
    expect(renderMarkdownToHtml("   ")).toBe("");
    expect(renderMarkdownToHtml("\n")).toBe("");
  });

  it("renders inline formatting", () => {
    const result = renderMarkdownToHtml("**bold** and *italic*");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("renders code blocks with pre/code tags", () => {
    const result = renderMarkdownToHtml("```js\nconst x = 1;\n```");
    expect(result).toContain("<pre>");
    expect(result).toContain("<code");
    expect(result).toContain("const x = 1;");
  });

  it("renders task lists via markdown-it-task-lists plugin", () => {
    const result = renderMarkdownToHtml("- [ ] unchecked\n- [x] checked");
    expect(result).toContain('type="checkbox"');
    expect(result).toContain("checked");
  });

  it("renders footnotes via markdown-it-footnote plugin", () => {
    const result = renderMarkdownToHtml("Text[^1]\n\n[^1]: Footnote content");
    expect(result).toContain("footnote");
  });

  it("linkifies URLs", () => {
    const result = renderMarkdownToHtml("Visit https://example.com today");
    expect(result).toContain('href="https://example.com"');
  });

  it("renders raw HTML as escaped text", () => {
    expect(renderMarkdownToHtml("<img src=x onerror=alert(1)>")).toBe(
      "<p>&lt;img src=x onerror=alert(1)&gt;</p>\n",
    );
  });

  it("returns the same instance on repeated calls (singleton)", () => {
    const result1 = renderMarkdownToHtml("# Test");
    const result2 = renderMarkdownToHtml("# Test");
    expect(result1).toBe(result2);
  });
});

describe("renderMarkdownWithHighlighting", () => {
  it("falls back to plain rendering when highlighter is null", () => {
    const markdown = "# Hello\n\n```js\nconst x = 1;\n```";
    const result = renderMarkdownWithHighlighting(markdown, null);
    const plainResult = renderMarkdownToHtml(markdown);
    expect(result).toBe(plainResult);
  });

  it("returns empty string for empty input even with null highlighter", () => {
    expect(renderMarkdownWithHighlighting("", null)).toBe("");
    expect(renderMarkdownWithHighlighting("   ", null)).toBe("");
  });

  it("renders non-code markdown the same with or without highlighter", () => {
    const markdown = "**bold** and *italic*";
    const result = renderMarkdownWithHighlighting(markdown, null);
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("renders raw HTML as escaped text with a highlighter", () => {
    const highlighter = {
      getLoadedLanguages: () => [],
      codeToHtml: () => "",
    } as unknown as HighlighterCore;

    expect(renderMarkdownWithHighlighting("<img src=x onerror=alert(1)>", highlighter)).toBe(
      "<p>&lt;img src=x onerror=alert(1)&gt;</p>\n",
    );
  });
});
