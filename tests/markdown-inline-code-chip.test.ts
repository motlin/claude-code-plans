import { describe, expect, it } from "vite-plus/test";
import { markdownCss, ruleDeclarations } from "./markdown-css";

describe("inline code chip", () => {
  it("tints the chip neutrally like upstream epitaxy-code-chip instead of the red prose chip", () => {
    expect(ruleDeclarations(markdownCss, ".markdown code")).toStrictEqual({
      "font-family": "var(--font-mono)",
      "font-size": "13px",
      "font-weight": "430",
      "line-height": "18.2px",
      background: "rgb(11 11 11 / 0.04)",
      border: "none",
      color: "inherit",
      "border-radius": "4px",
      padding: "1px 2px",
    });
  });

  it("inverts the chip tint in dark mode without reintroducing a color or border", () => {
    expect(ruleDeclarations(markdownCss, ":global(.dark) .markdown code")).toStrictEqual({
      background: "rgb(255 255 255 / 0.06)",
    });
  });

  it("keeps fenced code at the 20px code line-height the tightened chip would otherwise steal", () => {
    expect(ruleDeclarations(markdownCss, ".markdown pre code")).toStrictEqual({
      background: "none",
      border: "none",
      color: "inherit",
      padding: "0",
      "font-weight": "400",
      "line-height": "20px",
      "border-radius": "0",
    });
  });
});
