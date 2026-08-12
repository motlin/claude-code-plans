import type { HighlighterCore } from "@shikijs/core";
import { beforeEach, vi } from "vite-plus/test";
import {
  renderInlineMarkdownToHtml,
  renderMarkdownToHtml,
  renderMarkdownWithHighlighting,
  looksLikeMarkdown,
} from "../src/lib/client-markdown";

const { requestLanguageMock } = vi.hoisted(() => ({
  requestLanguageMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/hooks/use-shiki", () => ({
  requestLanguage: requestLanguageMock,
}));

beforeEach(() => {
  requestLanguageMock.mockClear();
});

/** Drops the copy-button chrome the fence renderer wraps every code block in. */
function withoutCopyChrome(html: string): string {
  return html
    .replaceAll('<div class="markdown-codeblock">', "")
    .replaceAll(/<div class="markdown-code-copy">[\s\S]*?<\/div><\/div>/g, "");
}

describe("renderInlineMarkdownToHtml", () => {
  it("renders inline markdown without a paragraph wrapper", () => {
    expect(renderInlineMarkdownToHtml("**bold** text")).toBe("<strong>bold</strong> text");
  });

  it("renders blank input as an empty string", () => {
    expect([renderInlineMarkdownToHtml(""), renderInlineMarkdownToHtml("   \n")]).toStrictEqual([
      "",
      "",
    ]);
  });

  it("linkifies URLs", () => {
    expect(renderInlineMarkdownToHtml("see https://example.com")).toBe(
      'see <a href="https://example.com">https://example.com</a>',
    );
  });
});

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

  it("renders code blocks when the language is unspecified", () => {
    expect(withoutCopyChrome(renderMarkdownToHtml("```\nplain code\n```"))).toBe(
      "<pre><code>plain code\n</code></pre>\n",
    );
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

  it("enables typographer without changing the default", () => {
    expect([
      renderMarkdownToHtml('He said "hi" -- ok', { typographer: true }),
      renderMarkdownToHtml('He said "hi" -- ok'),
    ]).toStrictEqual(["<p>He said “hi” – ok</p>\n", "<p>He said &quot;hi&quot; -- ok</p>\n"]);
  });

  it("caches plain markdown instances by typographer setting", () => {
    expect([
      renderMarkdownToHtml('He said "hi" -- ok'),
      renderMarkdownToHtml('He said "hi" -- ok', { typographer: true }),
      renderMarkdownToHtml('He said "hi" -- ok'),
    ]).toStrictEqual([
      "<p>He said &quot;hi&quot; -- ok</p>\n",
      "<p>He said “hi” – ok</p>\n",
      "<p>He said &quot;hi&quot; -- ok</p>\n",
    ]);
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

  it("forwards typographer options when the highlighter is null", () => {
    expect(renderMarkdownWithHighlighting('a "b" -- c', null, { typographer: true })).toBe(
      "<p>a “b” – c</p>\n",
    );
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

  it("uses a grammar loaded after the cached markdown instance was created", () => {
    const loadedLanguages: string[] = [];
    const codeToHtml = vi.fn(() => '<pre class="shiki"><code>highlighted</code></pre>');
    const highlighter = {
      getLoadedLanguages: () => loadedLanguages,
      codeToHtml,
    } as unknown as HighlighterCore;
    const markdown = "```typescript\nconst answer = 0;\n```";

    const beforeLoad = renderMarkdownWithHighlighting(markdown, highlighter);
    loadedLanguages.push("typescript");
    const afterLoad = renderMarkdownWithHighlighting(markdown, highlighter);

    expect({
      beforeLoad: withoutCopyChrome(beforeLoad),
      afterLoad: withoutCopyChrome(afterLoad),
      languageRequests: requestLanguageMock.mock.calls,
      highlightingCalls: codeToHtml.mock.calls,
    }).toStrictEqual({
      beforeLoad: '<pre><code class="language-typescript">const answer = 0;\n</code></pre>\n',
      afterLoad: '<pre class="shiki"><code>highlighted</code></pre>\n',
      languageRequests: [["typescript"]],
      highlightingCalls: [
        [
          "const answer = 0;",
          {
            lang: "typescript",
            themes: {
              light: "claude-light",
              dark: "github-dark",
            },
            defaultColor: "light",
            cssVariablePrefix: "--shiki-",
          },
        ],
      ],
    });
  });

  it("caches highlighted markdown instances by typographer setting", () => {
    const highlighter = {
      getLoadedLanguages: () => [],
      codeToHtml: () => "",
    } as unknown as HighlighterCore;

    expect([
      renderMarkdownWithHighlighting('He said "hi" -- ok', highlighter),
      renderMarkdownWithHighlighting('He said "hi" -- ok', highlighter, {
        typographer: true,
      }),
      renderMarkdownWithHighlighting('He said "hi" -- ok', highlighter),
    ]).toStrictEqual([
      "<p>He said &quot;hi&quot; -- ok</p>\n",
      "<p>He said “hi” – ok</p>\n",
      "<p>He said &quot;hi&quot; -- ok</p>\n",
    ]);
  });
});
