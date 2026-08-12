import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The markdown article stylesheet, read once so layout tests can assert on it. */
export const markdownCss = readFileSync(
  resolve(__dirname, "..", "src", "components", "markdown-article.module.css"),
  "utf8",
);

/** The declarations of the one rule whose selector list is exactly `selector`. */
export function ruleDeclarations(css: string, selector: string): Record<string, string> {
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
