import { renderMarkdown } from "../src/lib/markdown";

describe("renderMarkdown (lazy Shiki)", () => {
  it("renders headings to HTML", async () => {
    const html = await renderMarkdown("# Hello");
    expect(html).toContain("<h1>Hello</h1>");
  });

  it("renders empty/whitespace-only input as empty string", async () => {
    expect(await renderMarkdown("")).toBe("");
    expect(await renderMarkdown("   ")).toBe("");
    expect(await renderMarkdown("\n")).toBe("");
  });

  it("renders inline formatting", async () => {
    const html = await renderMarkdown("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders code blocks with Shiki when language is supported", async () => {
    const html = await renderMarkdown("```js\nconst x = 1;\n```");
    // Shiki produces a <pre class="shiki"...> with token spans
    expect(html).toContain("<pre");
    expect(html).toContain("shiki");
    expect(html).toContain("const");
  });

  it("renders code blocks even when language is unspecified", async () => {
    const html = await renderMarkdown("```\nplain code\n```");
    expect(html).toContain("plain code");
    expect(html).toContain("<pre");
  });

  it("linkifies URLs", async () => {
    const html = await renderMarkdown("Visit https://example.com today");
    expect(html).toContain('href="https://example.com"');
  });

  it("renders raw HTML as escaped text", async () => {
    expect(await renderMarkdown("<img src=x onerror=alert(1)>")).toBe(
      "<p>&lt;img src=x onerror=alert(1)&gt;</p>\n",
    );
  });

  it("caches highlighter across calls (second call resolves quickly)", async () => {
    await renderMarkdown("# First");
    const start = Date.now();
    await renderMarkdown("# Second");
    const elapsed = Date.now() - start;
    // Subsequent renders should not re-create the highlighter, so they
    // complete quickly. Loose bound; we just want to detect a regression
    // where every call rebuilds the highlighter.
    expect(elapsed).toBeLessThan(2000);
  });
});
