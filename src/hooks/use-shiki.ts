/**
 * Client-side Shiki highlighter singleton and React hook.
 *
 * Creates a single highlighter instance (lazy, on first use) shared across
 * all components. Uses the JavaScript regex engine (no WASM) for a lighter
 * client bundle.
 */
import type { HighlighterCore, ThemedToken } from "@shikijs/core";
import { useMemo, useSyncExternalStore } from "react";
import { useResolvedTheme } from "../components/theme-provider";

// ---------------------------------------------------------------------------
// Singleton highlighter
// ---------------------------------------------------------------------------

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterInstance: HighlighterCore | null = null;

/** Monotonically increasing version bumped each time the singleton resolves. */
let version = 0;
const subscribers = new Set<() => void>();

function notify(): void {
  version++;
  for (const callback of subscribers) {
    callback();
  }
}

function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

function getVersion(): number {
  return version;
}

async function initHighlighter(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, { claudeLight }] =
    await Promise.all([
      import("@shikijs/core"),
      import("@shikijs/engine-javascript"),
      import("../lib/claude-light-theme"),
    ]);

  const highlighter = await createHighlighterCore({
    themes: [claudeLight, import("shiki/themes/github-dark.mjs")],
    langs: [
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/tsx.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/jsx.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/python.mjs"),
      import("shiki/langs/css.mjs"),
      import("shiki/langs/html.mjs"),
      import("shiki/langs/markdown.mjs"),
      import("shiki/langs/yaml.mjs"),
      import("shiki/langs/shellscript.mjs"),
      import("shiki/langs/rust.mjs"),
      import("shiki/langs/go.mjs"),
      import("shiki/langs/ruby.mjs"),
      import("shiki/langs/java.mjs"),
      import("shiki/langs/sql.mjs"),
      import("shiki/langs/toml.mjs"),
      import("shiki/langs/xml.mjs"),
      import("shiki/langs/c.mjs"),
      import("shiki/langs/cpp.mjs"),
    ],
    engine: createJavaScriptRegexEngine(),
  });

  highlighterInstance = highlighter;
  notify();
  return highlighter;
}

/**
 * Get the shared highlighter instance (resolves once, then cached).
 * Callers that need async access (e.g., markdown-it integration) use this.
 */
function getHighlighterInstance(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = initHighlighter();
  }
  return highlighterPromise;
}

// Kick off loading on first import so the highlighter is ready sooner.
if (typeof window !== "undefined") {
  void getHighlighterInstance();
}

// ---------------------------------------------------------------------------
// Non-hook accessors for use in plain functions (e.g. markdown-it highlight)
// ---------------------------------------------------------------------------

/** Returns the highlighter if already loaded, otherwise null. */
export function getHighlighterSync(): HighlighterCore | null {
  return highlighterInstance;
}

/** Subscribe to highlighter readiness changes. */
export function subscribeHighlighter(callback: () => void): () => void {
  return subscribe(callback);
}

/** Snapshot function for useSyncExternalStore. */
export function getHighlighterVersion(): number {
  return getVersion();
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * Returns syntax-highlighted tokens for the given code and language.
 * Returns `null` while the highlighter is loading or when `language` is null.
 * Falls back to null for unknown/unloaded languages.
 */
export function useHighlightedLines(
  code: string,
  language: string | null,
  forceDark?: boolean,
): ThemedToken[][] | null {
  const resolvedTheme = useResolvedTheme();

  // Subscribe to highlighter readiness via useSyncExternalStore.
  const ready = useSyncExternalStore(subscribe, getVersion, () => 0);
  // `ready` is only used as a dependency to re-run the memo when the
  // highlighter becomes available. The linter doesn't see that, so we
  // reference it below to silence the warning.

  return useMemo(() => {
    void ready;
    if (!highlighterInstance || !language) return null;

    const themeName = forceDark || resolvedTheme === "dark" ? "github-dark" : "claude-light";

    try {
      const loadedLanguages = highlighterInstance.getLoadedLanguages();
      if (!loadedLanguages.includes(language)) return null;

      const result = highlighterInstance.codeToTokens(code, {
        lang: language,
        theme: themeName,
      });
      return result.tokens;
    } catch {
      return null;
    }
  }, [code, language, forceDark, resolvedTheme, ready]);
}
