import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { renderMarkdownToHtml } from "../src/lib/client-markdown";

const MARKDOWN_CSS = resolve(__dirname, "..", "src", "components", "markdown-article.module.css");

/** The declarations of the one rule whose selector list is exactly `selector`. */
function ruleDeclarations(css: string, selector: string): Record<string, string> {
  const open = css.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`selector not found: ${selector}`);
  const close = css.indexOf("}", open);
  if (close === -1) throw new Error(`unterminated rule: ${selector}`);

  const declarations: Record<string, string> = {};
  for (const declaration of css.slice(css.indexOf("{", open) + 1, close).split(";")) {
    const trimmed = declaration.trim();
    if (trimmed === "") continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) throw new Error(`declaration without a value: ${trimmed}`);
    declarations[trimmed.slice(0, colon).trim()] = trimmed
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, " ");
  }
  return declarations;
}

const TABLE_MARKDOWN = "| Tool | Calls |\n| --- | --- |\n| Read | 3 |\n";

describe("markdown block layout", () => {
  it("lays the article out as a gap-spaced column matching upstream epitaxy-markdown", () => {
    expect(ruleDeclarations(readFileSync(MARKDOWN_CSS, "utf8"), ".markdown")).toStrictEqual({
      display: "flex",
      "flex-direction": "column",
      gap: "10px",
      "font-family": "var(--font-sans)",
      "font-size": "14px",
      "font-weight": "400",
      "line-height": "20px",
      color: "var(--text-100)",
      "white-space": "normal",
    });
  });

  it("zeroes the block margins of every top-level block except hr", () => {
    const css = readFileSync(MARKDOWN_CSS, "utf8");

    expect(ruleDeclarations(css, ".markdown > :not(hr)")).toStrictEqual({
      "margin-block": "0",
    });
  });

  it("declares the margin reset after the per-element rules it has to beat", () => {
    const css = readFileSync(MARKDOWN_CSS, "utf8");
    const reset = css.indexOf(".markdown > :not(hr) {");

    expect({
      afterParagraph: reset > css.indexOf(".markdown p {"),
      afterHeading: reset > css.indexOf(".markdown h1 {"),
      afterBlockquote: reset > css.indexOf(".markdown blockquote {"),
      afterPre: reset > css.indexOf(".markdown pre {"),
    }).toStrictEqual({
      afterParagraph: true,
      afterHeading: true,
      afterBlockquote: true,
      afterPre: true,
    });
  });

  it("wraps long code lines instead of scrolling them horizontally", () => {
    const declarations = ruleDeclarations(readFileSync(MARKDOWN_CSS, "utf8"), ".markdown pre");

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
      ruleDeclarations(
        readFileSync(MARKDOWN_CSS, "utf8"),
        ".markdown :global(.markdown-table-wrapper)",
      ),
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
