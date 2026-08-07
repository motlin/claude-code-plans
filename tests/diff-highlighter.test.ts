import type { DiffAST } from "@git-diff-view/core";
import { describe, expect, it } from "vite-plus/test";
import { isShikiLanguageSupported, requestLanguage } from "../src/hooks/use-shiki";
import { EXTENSION_TO_LANGUAGE } from "../src/lib/diff-utils";
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
    ).toStrictEqual(["tsx", "python", "cpp", "csharp", "text", "text"]);
  });

  it("can load every language the extension map detects", () => {
    const unloadable = [...new Set(Object.values(EXTENSION_TO_LANGUAGE))]
      .filter((language) => !isShikiLanguageSupported(language))
      .sort();
    expect(unloadable).toStrictEqual([]);
  });

  it("registers a grammar requested by one of its aliases", async () => {
    await requestLanguage("dockerfile");
    expect(shikiDiffHighlighter.hasRegisteredCurrentLang("dockerfile")).toBe(true);
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
