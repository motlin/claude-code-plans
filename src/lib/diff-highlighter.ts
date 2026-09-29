import type { DiffAST, DiffFileHighlighter } from "@git-diff-view/core";
import { processAST } from "@git-diff-view/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useCodeThemes } from "../hooks/use-code-themes";
import {
  getHighlighterSync,
  getHighlighterVersion,
  isShikiLanguageSupported,
  requestLanguage,
  subscribeHighlighter,
  themeOrRequest,
} from "../hooks/use-shiki";
import { type CodeThemePair, DEFAULT_CODE_THEMES, loadedThemeOr } from "./code-themes";
import { detectLanguage } from "./diff-utils";
import { SHIKI_TOKENIZE_OPTIONS } from "./shiki-tokenize-options";

let maximumHighlightedLines = 2000;
const ignoredFiles: (string | RegExp)[] = [];

function plainTextAST(raw: string): DiffAST {
  return {
    type: "root",
    children: [{ type: "text", value: raw }],
  };
}

/**
 * A DiffView highlighter for one code theme pair. The pair is in the name
 * because DiffView only re-highlights when the adapter's name changes.
 */
export function createShikiDiffHighlighter(themes: CodeThemePair) {
  return {
    name: `shiki:${themes.light}:${themes.dark}`,
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
      const mode = theme === "dark" ? "dark" : "light";
      return highlighter.codeToHast(raw, {
        ...SHIKI_TOKENIZE_OPTIONS,
        lang: language,
        theme: loadedThemeOr(highlighter, themes[mode], DEFAULT_CODE_THEMES[mode]),
      });
    },
    processAST,
    hasRegisteredCurrentLang(language: string): boolean {
      return (
        language === "text" ||
        Boolean(getHighlighterSync()?.getLoadedLanguages().includes(language))
      );
    },
  } satisfies DiffFileHighlighter;
}

export const shikiDiffHighlighter = createShikiDiffHighlighter(DEFAULT_CODE_THEMES);

export function resolveDiffLanguage(filePath: string): string {
  const language = detectLanguage(filePath);
  return language && isShikiLanguageSupported(language) ? language : "text";
}

export function useShikiDiffHighlighter(language: string): DiffFileHighlighter {
  const codeThemes = useCodeThemes();
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
    const highlighter = getHighlighterSync();
    // Name the adapter after the themes it can actually use right now, so
    // DiffView re-highlights once a newly picked theme finishes loading.
    return createShikiDiffHighlighter(
      highlighter === null
        ? DEFAULT_CODE_THEMES
        : {
            light:
              codeThemes.light === DEFAULT_CODE_THEMES.light
                ? codeThemes.light
                : themeOrRequest(highlighter, codeThemes.light, DEFAULT_CODE_THEMES.light),
            dark:
              codeThemes.dark === DEFAULT_CODE_THEMES.dark
                ? codeThemes.dark
                : themeOrRequest(highlighter, codeThemes.dark, DEFAULT_CODE_THEMES.dark),
          },
    );
  }, [codeThemes, highlighterVersion]);
}
