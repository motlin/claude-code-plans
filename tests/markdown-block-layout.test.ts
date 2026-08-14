import { describe, expect, it } from "vite-plus/test";
import { renderMarkdownToHtml } from "../src/lib/client-markdown";
import { markdownCss, ruleDeclarations } from "./markdown-css";

const TABLE_MARKDOWN = "| Tool | Calls |\n| --- | --- |\n| Read | 3 |\n";

describe("markdown block layout", () => {
  it("lays the article out as a gap-spaced column matching upstream epitaxy-markdown", () => {
    expect(ruleDeclarations(markdownCss, ".markdown")).toStrictEqual({
      display: "flex",
      "flex-direction": "column",
      gap: "10px",
      "font-family": "var(--font-sans)",
      "font-size": "14px",
      "font-weight": "400",
      "line-height": "20px",
      color: "var(--color-primary)",
      "white-space": "normal",
    });
  });

  it("zeroes the block margins of every top-level block except hr", () => {
    expect(ruleDeclarations(markdownCss, ".markdown > :not(hr)")).toStrictEqual({
      "margin-block": "0",
    });
  });

  it("declares the margin reset after the per-element rules it has to beat", () => {
    const reset = markdownCss.indexOf(".markdown > :not(hr) {");

    expect({
      afterParagraph: reset > markdownCss.indexOf(".markdown p {"),
      afterHeading: reset > markdownCss.indexOf(".markdown h1 {"),
      afterBlockquote: reset > markdownCss.indexOf(".markdown blockquote {"),
      afterPre: reset > markdownCss.indexOf(".markdown pre {"),
    }).toStrictEqual({
      afterParagraph: true,
      afterHeading: true,
      afterBlockquote: true,
      afterPre: true,
    });
  });

  it("wraps long code lines instead of scrolling them horizontally", () => {
    const declarations = ruleDeclarations(markdownCss, ".markdown pre");

    expect({
      whiteSpace: declarations["white-space"],
      overflowWrap: declarations["overflow-wrap"],
      overflowX: declarations["overflow-x"],
      width: declarations["width"],
      maxWidth: declarations["max-width"],
    }).toStrictEqual({
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      overflowX: "visible",
      width: "fit-content",
      maxWidth: "100%",
    });
  });

  it("scrolls wide tables inside their wrapper", () => {
    expect(
      ruleDeclarations(markdownCss, ".markdown :global(.markdown-table-wrapper)"),
    ).toStrictEqual({ "overflow-x": "auto" });
  });

  it("renders tables inside a horizontally scrollable wrapper", () => {
    const html = renderMarkdownToHtml(TABLE_MARKDOWN);

    expect({
      opens: html.includes('<div class="markdown-table-wrapper"><table>'),
      closes: html.includes("</table>\n</div>"),
      wrappers: html.match(/markdown-table-wrapper/g)?.length ?? 0,
    }).toStrictEqual({ opens: true, closes: true, wrappers: 1 });
  });

  it("leaves non-table markdown unwrapped", () => {
    expect(renderMarkdownToHtml("plain paragraph").includes("markdown-table-wrapper")).toBe(false);
  });
});
