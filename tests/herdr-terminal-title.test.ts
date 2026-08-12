import { describe, expect, it } from "vite-plus/test";
import { splitTerminalTitleGlyph } from "../src/lib/herdr/terminal-title";

describe("splitTerminalTitleGlyph", () => {
  it("splits a single leading status glyph off herdr terminal titles", () => {
    expect(
      [
        "✳ Teammate availability notification",
        "✓ kalshi",
        "$ claude-code-plugins",
        "* ✓ $ Alice terminal",
        "kalshi",
        "/tmp/test/project-1",
        "✳",
        "",
      ].map(splitTerminalTitleGlyph),
    ).toStrictEqual([
      { glyph: "✳", title: "Teammate availability notification" },
      { glyph: "✓", title: "kalshi" },
      { glyph: "$", title: "claude-code-plugins" },
      { glyph: "*", title: "✓ $ Alice terminal" },
      { glyph: null, title: "kalshi" },
      { glyph: null, title: "/tmp/test/project-1" },
      { glyph: null, title: "✳" },
      { glyph: null, title: "" },
    ]);
  });
});
