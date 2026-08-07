import type { DiffAST } from "@git-diff-view/core";
import { describe, expect, it } from "vite-plus/test";
import { requestLanguage } from "../src/hooks/use-shiki";
import { resolveDiffLanguage, shikiDiffHighlighter } from "../src/lib/diff-highlighter";

function summarizeStyles(ast: DiffAST) {
  const processed = shikiDiffHighlighter.processAST(ast);
  return Object.values(processed.syntaxFileObject).map((line) => ({
    lineNumber: line.lineNumber,
    value: line.value,
    styles: line.nodeList.map(({ wrapper }) => wrapper?.properties?.["style"] ?? null),
  }));
}

describe("Shiki diff highlighter", () => {
  it("uses the Shiki loader registry as the supported-language source", () => {
    expect(
      [
        "/tmp/test/component.tsx",
        "/tmp/test/script.py",
        "/tmp/test/source.cpp",
        "/tmp/test/program.cs",
        "/tmp/test/README.md",
        "/tmp/test/unknown.example",
      ].map(resolveDiffLanguage),
    ).toStrictEqual(["tsx", "python", "cpp", "text", "text", "text"]);
  });

  it("produces theme-specific inline styles and processed syntax lines", async () => {
    await requestLanguage("typescript");

    const lightAST = shikiDiffHighlighter.getAST(
      "return answer;",
      "/tmp/test/example.ts",
      "typescript",
      "light",
    );
    const darkAST = shikiDiffHighlighter.getAST(
      "return answer;",
      "/tmp/test/example.ts",
      "typescript",
      "dark",
    );

    expect({
      adapter: {
        name: shikiDiffHighlighter.name,
        type: shikiDiffHighlighter.type,
        maximumHighlightedLines: shikiDiffHighlighter.maxLineToIgnoreSyntax,
        ignoredFiles: shikiDiffHighlighter.ignoreSyntaxHighlightList,
      },
      hasTypeScript: shikiDiffHighlighter.hasRegisteredCurrentLang("typescript"),
      hasUnknownLanguage: shikiDiffHighlighter.hasRegisteredCurrentLang("example"),
      lightLines: summarizeStyles(lightAST),
      darkLines: summarizeStyles(darkAST),
    }).toStrictEqual({
      adapter: {
        name: "shiki",
        type: "style",
        maximumHighlightedLines: 2000,
        ignoredFiles: [],
      },
      hasTypeScript: true,
      hasUnknownLanguage: false,
      lightLines: [
        {
          lineNumber: 1,
          value: "return answer;",
          styles: ["color:#8100C2", "color:#141413"],
        },
      ],
      darkLines: [
        {
          lineNumber: 1,
          value: "return answer;",
          styles: ["color:#F97583", "color:#E1E4E8"],
        },
      ],
    });
  });
});
