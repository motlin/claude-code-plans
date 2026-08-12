import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const GLOBALS_CSS = resolve(__dirname, "..", "src", "styles", "globals.css");

/**
 * The override has to out-specify @git-diff-view's own
 * `.diff-tailwindcss-wrapper[data-theme="light"] .diff-style-root` rule (0,3,0)
 * regardless of stylesheet order, so it carries an extra attribute selector.
 */
const OVERRIDE_SELECTOR =
  '.diff-tailwindcss-wrapper[data-component="git-diff-view"][data-theme] .diff-style-root';

/**
 * The library hard-codes its own mono stack as an *inline* style on the table
 * wrapper, so only `!important` can pull diff text onto the app font.
 */
const FONT_SELECTOR = ".diff-tailwindcss-wrapper .diff-table-scroll-container";

/**
 * The row leading override has to beat the library's own `leading-[1.6]` rule
 * (0,2,0) regardless of stylesheet order, so it carries an extra attribute.
 */
const LEADING_SELECTOR =
  '.diff-tailwindcss-wrapper[data-component="git-diff-view"] .diff-table-body';

/** The library build whose inline styles and class names the overrides target. */
const LIBRARY_BUNDLE = resolve(
  __dirname,
  "..",
  "node_modules",
  "@git-diff-view",
  "react",
  "dist",
  "esm",
  "index.mjs",
);

/**
 * The declarations of one CSS rule. Values are whitespace-normalized onto a
 * single line so that Prettier's wrapping of long `color-mix()` arguments does
 * not change what this test sees.
 */
function ruleDeclarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) throw new Error(`unterminated rule: ${selector}`);

  const declarations: Record<string, string> = {};
  for (const declaration of css.slice(open + 1, close).split(";")) {
    const trimmed = declaration.trim();
    if (trimmed === "") continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) throw new Error(`declaration without a value: ${trimmed}`);
    declarations[trimmed.slice(0, colon).trim()] = trimmed
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, " ")
      .replaceAll("( ", "(")
      .replaceAll(" )", ")");
  }
  return declarations;
}

/** Every custom property the declarations read through `var(...)`. */
function referencedTokens(declarations: Record<string, string>): string[] {
  const tokens = new Set<string>();
  for (const value of Object.values(declarations)) {
    for (const match of value.matchAll(/var\((--[\w-]+)\)/g)) tokens.add(match[1]!);
  }
  return [...tokens].sort();
}

/** The tokens a top-level block (`:root`, `.dark`) of globals.css leaves undefined. */
function tokensMissingFrom(css: string, selector: string, tokens: string[]): string[] {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`block not found: ${selector}`);
  const block = css.slice(start, css.indexOf("\n}", start));
  return tokens.filter((token) => !new RegExp(`^\\s*${token}:`, "m").test(block));
}

describe("diff view row colors", () => {
  it("maps the @git-diff-view row surfaces this app renders onto upstream tokens", () => {
    const declarations = ruleDeclarations(readFileSync(GLOBALS_CSS, "utf8"), OVERRIDE_SELECTOR);

    expect(declarations).toStrictEqual({
      "--diff-border--": "var(--card-outline)",
      "--diff-add-content--": "color-mix(in srgb, var(--upstream-extended-green) 20%, transparent)",
      "--diff-add-lineNumber--":
        "color-mix(in srgb, var(--upstream-extended-green) 28%, transparent)",
      "--diff-add-content-highlight--":
        "color-mix(in srgb, var(--upstream-extended-green) 35%, transparent)",
      "--diff-del-content--": "color-mix(in srgb, var(--upstream-extended-pink) 20%, transparent)",
      "--diff-del-lineNumber--":
        "color-mix(in srgb, var(--upstream-extended-pink) 28%, transparent)",
      "--diff-del-content-highlight--":
        "color-mix(in srgb, var(--upstream-extended-pink) 35%, transparent)",
      "--diff-plain-content--": "transparent",
      "--diff-plain-lineNumber--": "transparent",
      "--diff-expand-content--": "transparent",
      "--diff-expand-lineNumber--": "transparent",
      "--diff-empty-content--": "transparent",
      "--diff-plain-lineNumber-color--": "var(--upstream-text-assistant-secondary)",
      "--diff-expand-lineNumber-color--": "var(--upstream-text-assistant-secondary)",
    });
  });

  it("reads only tokens that both themes define, so one rule covers light and dark", () => {
    const css = readFileSync(GLOBALS_CSS, "utf8");
    const tokens = referencedTokens(ruleDeclarations(css, OVERRIDE_SELECTOR));

    expect({
      root: tokensMissingFrom(css, ":root", tokens),
      dark: tokensMissingFrom(css, ".dark", tokens),
    }).toStrictEqual({ root: [], dark: [] });
  });
});

describe("diff view typography", () => {
  it("sets diff rows in the app mono face on upstream's code leading", () => {
    const css = readFileSync(GLOBALS_CSS, "utf8");

    expect({
      font: ruleDeclarations(css, FONT_SELECTOR),
      leading: ruleDeclarations(css, LEADING_SELECTOR),
    }).toStrictEqual({
      font: { "font-family": "var(--font-mono) !important" },
      leading: { "line-height": "var(--upstream-leading-code)" },
    });
  });

  it("targets the wrapper and row classes @git-diff-view actually renders", () => {
    const bundle = readFileSync(LIBRARY_BUNDLE, "utf8");

    expect({
      wrapper: bundle.includes('"unified-diff-table-wrapper diff-table-scroll-container'),
      rows: bundle.includes('"diff-table-body leading-[1.6]"'),
      inlineFont: bundle.includes('fontFamily: "Menlo, Consolas, monospace"'),
    }).toStrictEqual({ wrapper: true, rows: true, inlineFont: true });
  });
});
