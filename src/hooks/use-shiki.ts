/**
 * Client-side Shiki highlighter singleton and React hook.
 *
 * Creates a single highlighter instance (lazy, on first use) shared across
 * all components. Uses the JavaScript regex engine (no WASM) for a lighter
 * client bundle.
 */
import type {
  DynamicImportLanguageRegistration,
  HighlighterCore,
  ThemedToken,
} from "@shikijs/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useResolvedTheme } from "../components/theme-provider";

// ---------------------------------------------------------------------------
// Singleton highlighter
// ---------------------------------------------------------------------------

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterInstance: HighlighterCore | null = null;
const languageLoadPromises = new Map<DynamicImportLanguageRegistration, Promise<void>>();

const loadTypeScript = () => import("shiki/langs/typescript.mjs");
const loadTsx = () => import("shiki/langs/tsx.mjs");
const loadJavaScript = () => import("shiki/langs/javascript.mjs");
const loadJsx = () => import("shiki/langs/jsx.mjs");
const loadJson = () => import("shiki/langs/json.mjs");
const loadPython = () => import("shiki/langs/python.mjs");
const loadCss = () => import("shiki/langs/css.mjs");
const loadHtml = () => import("shiki/langs/html.mjs");
const loadMarkdown = () => import("shiki/langs/markdown.mjs");
const loadYaml = () => import("shiki/langs/yaml.mjs");
const loadShellScript = () => import("shiki/langs/shellscript.mjs");
const loadRust = () => import("shiki/langs/rust.mjs");
const loadGo = () => import("shiki/langs/go.mjs");
const loadRuby = () => import("shiki/langs/ruby.mjs");
const loadJava = () => import("shiki/langs/java.mjs");
const loadSql = () => import("shiki/langs/sql.mjs");
const loadToml = () => import("shiki/langs/toml.mjs");
const loadXml = () => import("shiki/langs/xml.mjs");
const loadC = () => import("shiki/langs/c.mjs");
const loadCpp = () => import("shiki/langs/cpp.mjs");
const loadCsharp = () => import("shiki/langs/csharp.mjs");
const loadKotlin = () => import("shiki/langs/kotlin.mjs");
const loadSwift = () => import("shiki/langs/swift.mjs");
const loadPhp = () => import("shiki/langs/php.mjs");
const loadScss = () => import("shiki/langs/scss.mjs");
const loadLess = () => import("shiki/langs/less.mjs");
const loadJsonc = () => import("shiki/langs/jsonc.mjs");
const loadGraphql = () => import("shiki/langs/graphql.mjs");
const loadDocker = () => import("shiki/langs/docker.mjs");
const loadLua = () => import("shiki/langs/lua.mjs");
const loadR = () => import("shiki/langs/r.mjs");
const loadVue = () => import("shiki/langs/vue.mjs");
const loadSvelte = () => import("shiki/langs/svelte.mjs");
const loadAstro = () => import("shiki/langs/astro.mjs");
const loadZig = () => import("shiki/langs/zig.mjs");
const loadElixir = () => import("shiki/langs/elixir.mjs");
const loadErlang = () => import("shiki/langs/erlang.mjs");
const loadHcl = () => import("shiki/langs/hcl.mjs");
const loadIni = () => import("shiki/langs/ini.mjs");
const loadDotenv = () => import("shiki/langs/dotenv.mjs");
const loadFish = () => import("shiki/langs/fish.mjs");

const shikiLanguageLoaders: Record<string, DynamicImportLanguageRegistration> = {
  astro: loadAstro,
  bash: loadShellScript,
  c: loadC,
  "c#": loadCsharp,
  "c++": loadCpp,
  cjs: loadJavaScript,
  cpp: loadCpp,
  cs: loadCsharp,
  csharp: loadCsharp,
  css: loadCss,
  cts: loadTypeScript,
  docker: loadDocker,
  dockerfile: loadDocker,
  dotenv: loadDotenv,
  elixir: loadElixir,
  erl: loadErlang,
  erlang: loadErlang,
  fish: loadFish,
  go: loadGo,
  gql: loadGraphql,
  graphql: loadGraphql,
  hcl: loadHcl,
  html: loadHtml,
  ini: loadIni,
  java: loadJava,
  javascript: loadJavaScript,
  js: loadJavaScript,
  jsx: loadJsx,
  json: loadJson,
  jsonc: loadJsonc,
  kotlin: loadKotlin,
  kt: loadKotlin,
  less: loadLess,
  lua: loadLua,
  markdown: loadMarkdown,
  md: loadMarkdown,
  mjs: loadJavaScript,
  mts: loadTypeScript,
  php: loadPhp,
  py: loadPython,
  python: loadPython,
  r: loadR,
  rb: loadRuby,
  rs: loadRust,
  ruby: loadRuby,
  rust: loadRust,
  scss: loadScss,
  sh: loadShellScript,
  shell: loadShellScript,
  shellscript: loadShellScript,
  sql: loadSql,
  svelte: loadSvelte,
  swift: loadSwift,
  toml: loadToml,
  ts: loadTypeScript,
  tsx: loadTsx,
  typescript: loadTypeScript,
  vue: loadVue,
  xml: loadXml,
  yaml: loadYaml,
  yml: loadYaml,
  zig: loadZig,
  zsh: loadShellScript,
};

export function isShikiLanguageSupported(language: string): boolean {
  return language in shikiLanguageLoaders;
}

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
  const [
    { createHighlighterCore },
    { createJavaScriptRegexEngine },
    { claudeLight },
    { default: githubDark },
  ] = await Promise.all([
    import("@shikijs/core"),
    import("@shikijs/engine-javascript"),
    import("../lib/claude-light-theme"),
    import("shiki/themes/github-dark.mjs"),
  ]);

  const highlighter = await createHighlighterCore({
    themes: [claudeLight, githubDark],
    langs: [],
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

/** Load a supported grammar once and notify subscribers when it becomes available. */
export function requestLanguage(language: string): Promise<void> {
  if (highlighterInstance?.getLoadedLanguages().includes(language)) {
    return Promise.resolve();
  }

  const loadLanguage = shikiLanguageLoaders[language];
  if (!loadLanguage) return Promise.resolve();

  const pendingLoad = languageLoadPromises.get(loadLanguage);
  if (pendingLoad) return pendingLoad;

  const languageLoad = Promise.all([getHighlighterInstance(), loadLanguage()])
    .then(async ([highlighter, languageModule]) => {
      if (highlighter.getLoadedLanguages().includes(language)) return;
      await highlighter.loadLanguage(languageModule.default);
      notify();
    })
    .finally(() => {
      languageLoadPromises.delete(loadLanguage);
    });
  languageLoadPromises.set(loadLanguage, languageLoad);
  return languageLoad;
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
export function useHighlightedLines(code: string, language: string | null): ThemedToken[][] | null {
  const resolvedTheme = useResolvedTheme();

  // Subscribe to highlighter readiness via useSyncExternalStore.
  const highlighterVersion = useSyncExternalStore(subscribe, getVersion, () => 0);

  useEffect(() => {
    if (!language || highlighterInstance?.getLoadedLanguages().includes(language)) return;
    void requestLanguage(language);
  }, [language, highlighterVersion]);

  return useMemo(() => {
    void highlighterVersion;
    if (!highlighterInstance || !language) return null;

    const themeName = resolvedTheme === "dark" ? "github-dark" : "claude-light";

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
  }, [code, language, resolvedTheme, highlighterVersion]);
}
