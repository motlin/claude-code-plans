import type { DiffAST, DiffFileHighlighter } from "@git-diff-view/core";
import { processAST } from "@git-diff-view/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  getHighlighterSync,
  getHighlighterVersion,
  isShikiLanguageSupported,
  requestLanguage,
  subscribeHighlighter,
} from "../hooks/use-shiki";
import { detectLanguage } from "./diff-utils";

let maximumHighlightedLines = 2000;
const ignoredFiles: (string | RegExp)[] = [];

function plainTextAST(raw: string): DiffAST {
  return {
    type: "root",
    children: [{ type: "text", value: raw }],
  };
}

export const shikiDiffHighlighter = {
  name: "shiki",
  type: "style",
  get maxLineToIgnoreSyntax() {
    return maximumHighlightedLines;
  },
  setMaxLineToIgnoreSyntax(value: number): void {
    maximumHighlightedLines = value;
  },
  get ignoreSyntaxHighlightList() {
    return ignoredFiles;
  },
  setIgnoreSyntaxHighlightList(value: (string | RegExp)[]): void {
    ignoredFiles.splice(0, ignoredFiles.length, ...value);
  },
  getAST(raw: string, fileName?: string, language?: string, theme?: "light" | "dark"): DiffAST {
    if (
      language === "text" ||
      (fileName &&
        ignoredFiles.some((ignoredFile) =>
          ignoredFile instanceof RegExp ? ignoredFile.test(fileName) : ignoredFile === fileName,
        ))
    ) {
      return plainTextAST(raw);
    }
    if (!language) throw new Error("A language is required for Shiki diff highlighting.");

    const highlighter = getHighlighterSync();
    if (!highlighter) throw new Error("The Shiki highlighter is not ready.");
    return highlighter.codeToHast(raw, {
      lang: language,
      theme: theme === "dark" ? "github-dark" : "claude-light",
    });
  },
  processAST,
  hasRegisteredCurrentLang(language: string): boolean {
    return (
      language === "text" || Boolean(getHighlighterSync()?.getLoadedLanguages().includes(language))
    );
  },
} satisfies DiffFileHighlighter;

export function resolveDiffLanguage(filePath: string): string {
  const language = detectLanguage(filePath);
  return language && isShikiLanguageSupported(language) ? language : "text";
}

export function useShikiDiffHighlighter(language: string): DiffFileHighlighter {
  const highlighterVersion = useSyncExternalStore(
    subscribeHighlighter,
    getHighlighterVersion,
    () => 0,
  );

  useEffect(() => {
    if (!isShikiLanguageSupported(language)) return;
    void requestLanguage(language);
  }, [language]);

  return useMemo(() => {
    void highlighterVersion;
    return { ...shikiDiffHighlighter };
  }, [highlighterVersion]);
}
