import type { HighlighterCore, LanguageRegistration } from "@shikijs/core";
import { describe, expect, it, vi } from "vite-plus/test";

const shikiMocks = vi.hoisted(() => {
  const importedLanguages: string[] = [];
  const loadedLanguages: string[] = [];
  const typeScriptRegistration = {
    name: "typescript",
    scopeName: "source.test.typescript",
  } as LanguageRegistration;
  const cppRegistration = {
    name: "cpp",
    scopeName: "source.test.cpp",
  } as LanguageRegistration;
  const engine = { name: "test-engine" };
  const claudeLight = { name: "claude-light", type: "light", settings: [] };
  const githubDark = { name: "github-dark", type: "dark", settings: [] };
  const loadLanguage = vi.fn(async () => {
    loadedLanguages.push("typescript", "ts", "cts", "mts");
  });
  const highlighter = {
    getLoadedLanguages: () => loadedLanguages,
    loadLanguage,
  } as unknown as HighlighterCore;
  const createHighlighterCore = vi.fn(async () => highlighter);

  return {
    claudeLight,
    cppRegistration,
    createHighlighterCore,
    engine,
    githubDark,
    highlighter,
    importedLanguages,
    loadLanguage,
    loadedLanguages,
    typeScriptRegistration,
  };
});

vi.mock("@shikijs/core", () => ({
  createHighlighterCore: shikiMocks.createHighlighterCore,
}));

vi.mock("@shikijs/engine-javascript", () => ({
  createJavaScriptRegexEngine: () => shikiMocks.engine,
}));

vi.mock("../src/lib/claude-light-theme", () => ({
  claudeLight: shikiMocks.claudeLight,
}));

vi.mock("shiki/themes/github-dark.mjs", () => ({
  default: shikiMocks.githubDark,
}));

vi.mock("shiki/langs/typescript.mjs", () => {
  shikiMocks.importedLanguages.push("typescript");
  return { default: [shikiMocks.typeScriptRegistration] };
});

vi.mock("shiki/langs/cpp.mjs", () => {
  shikiMocks.importedLanguages.push("cpp");
  return { default: [shikiMocks.cppRegistration] };
});

import {
  getHighlighterVersion,
  requestLanguage,
  subscribeHighlighter,
} from "../src/hooks/use-shiki";

describe("requestLanguage", () => {
  it("starts with no grammars, deduplicates aliases, and notifies after loading", async () => {
    const notifiedVersions: number[] = [];
    const unsubscribe = subscribeHighlighter(() => {
      notifiedVersions.push(getHighlighterVersion());
    });

    const firstRequest = requestLanguage("ts");
    const duplicateRequest = requestLanguage("typescript");

    expect(duplicateRequest).toBe(firstRequest);
    await firstRequest;
    unsubscribe();

    expect({
      createHighlighterCalls: shikiMocks.createHighlighterCore.mock.calls,
      importedLanguages: shikiMocks.importedLanguages,
      languageLoadCalls: shikiMocks.loadLanguage.mock.calls,
      loadedLanguages: shikiMocks.loadedLanguages,
      notifiedVersions,
    }).toStrictEqual({
      createHighlighterCalls: [
        [
          {
            themes: [shikiMocks.claudeLight, shikiMocks.githubDark],
            langs: [],
            engine: shikiMocks.engine,
          },
        ],
      ],
      importedLanguages: ["typescript"],
      languageLoadCalls: [[[shikiMocks.typeScriptRegistration]]],
      loadedLanguages: ["typescript", "ts", "cts", "mts"],
      notifiedVersions: [1, 2],
    });
  });
});
