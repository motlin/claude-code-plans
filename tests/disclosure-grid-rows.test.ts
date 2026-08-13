import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ruleDeclarations } from "./markdown-css";

const globalsCss = readFileSync(resolve(__dirname, "..", "src", "styles", "globals.css"), "utf8");

/**
 * Tool bodies mount behind `<Suspense fallback={null}>` with a lazily imported
 * renderer, so at the instant the class flips to `.grid-rows-expand` the row
 * subtree is still empty and `1fr` resolves to 0px. A transition captures that
 * 0px as its target and freezes there, leaving the body clipped to zero height
 * once the real content arrives. The tracks must therefore resize instantly.
 */
describe("disclosure grid row utilities", () => {
  it("collapses and expands without animating grid-template-rows", () => {
    expect({
      collapse: ruleDeclarations(globalsCss, ".grid-rows-collapse"),
      expand: ruleDeclarations(globalsCss, ".grid-rows-expand"),
    }).toStrictEqual({
      collapse: { "grid-template-rows": "0fr" },
      expand: { "grid-template-rows": "1fr" },
    });
  });
});
