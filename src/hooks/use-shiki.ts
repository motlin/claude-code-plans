/**
 * Client-side Shiki highlighter singleton and React hook.
 *
 * Creates a single highlighter instance (lazy, on first use) shared across
 * all components. Uses the JavaScript regex engine (no WASM) for a lighter
 * client bundle.
 */
import type {DynamicImportLanguageRegistration, HighlighterCore, ThemedToken} from "@shikijs/core";
import {useEffect, useMemo, useSyncExternalStore} from "react";
import {useResolvedTheme} from "../components/theme-context";
import {type CodeThemeId, DEFAULT_CODE_THEMES, loadCodeTheme, loadedThemeOr} from "../lib/code-themes";
import {SHIKI_TOKENIZE_OPTIONS} from "../lib/shiki-tokenize-options";
import {useCodeThemes} from "./use-code-themes";

// ---------------------------------------------------------------------------
// Singleton highlighter
// ---------------------------------------------------------------------------

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterInstance: HighlighterCore | null = null;
const languageLoadPromises = new Map<DynamicImportLanguageRegistration, Promise<void>>();
const themeLoadPromises = new Map<CodeThemeId, Promise<void>>();

const loadTypeScript = async () => import("shiki/langs/typescript.mjs");
const loadTsx = async () => import("shiki/langs/tsx.mjs");
const loadJavaScript = async () => import("shiki/langs/javascript.mjs");
const loadJsx = async () => import("shiki/langs/jsx.mjs");
const loadJson = async () => import("shiki/langs/json.mjs");
const loadPython = async () => import("shiki/langs/python.mjs");
const loadCss = async () => import("shiki/langs/css.mjs");
const loadHtml = async () => import("shiki/langs/html.mjs");
const loadMarkdown = async () => import("shiki/langs/markdown.mjs");
const loadYaml = async () => import("shiki/langs/yaml.mjs");
const loadShellScript = async () => import("shiki/langs/shellscript.mjs");
const loadRust = async () => import("shiki/langs/rust.mjs");
const loadGo = async () => import("shiki/langs/go.mjs");
const loadRuby = async () => import("shiki/langs/ruby.mjs");
const loadJava = async () => import("shiki/langs/java.mjs");
const loadSql = async () => import("shiki/langs/sql.mjs");
const loadToml = async () => import("shiki/langs/toml.mjs");
const loadXml = async () => import("shiki/langs/xml.mjs");
const loadC = async () => import("shiki/langs/c.mjs");
const loadCpp = async () => import("shiki/langs/cpp.mjs");
const loadCsharp = async () => import("shiki/langs/csharp.mjs");
const loadKotlin = async () => import("shiki/langs/kotlin.mjs");
const loadSwift = async () => import("shiki/langs/swift.mjs");
const loadPhp = async () => import("shiki/langs/php.mjs");
const loadScss = async () => import("shiki/langs/scss.mjs");
const loadLess = async () => import("shiki/langs/less.mjs");
const loadJsonc = async () => import("shiki/langs/jsonc.mjs");
const loadGraphql = async () => import("shiki/langs/graphql.mjs");
const loadDocker = async () => import("shiki/langs/docker.mjs");
const loadLua = async () => import("shiki/langs/lua.mjs");
const loadR = async () => import("shiki/langs/r.mjs");
const loadVue = async () => import("shiki/langs/vue.mjs");
const loadSvelte = async () => import("shiki/langs/svelte.mjs");
const loadAstro = async () => import("shiki/langs/astro.mjs");
const loadZig = async () => import("shiki/langs/zig.mjs");
const loadElixir = async () => import("shiki/langs/elixir.mjs");
const loadErlang = async () => import("shiki/langs/erlang.mjs");
const loadHcl = async () => import("shiki/langs/hcl.mjs");
const loadIni = async () => import("shiki/langs/ini.mjs");
const loadDotenv = async () => import("shiki/langs/dotenv.mjs");
const loadFish = async () => import("shiki/langs/fish.mjs");

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
	const [{createHighlighterCore}, {createJavaScriptRegexEngine}, {claudeLight}, {default: githubDark}] =
		await Promise.all([
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
// oxlint-disable-next-line typescript/promise-function-async -- returns the one shared highlighter promise
function getHighlighterInstance(): Promise<HighlighterCore> {
	highlighterPromise ??= initHighlighter();
	return highlighterPromise;
}

/** Load a supported grammar once and notify subscribers when it becomes available. */
// oxlint-disable-next-line typescript/promise-function-async -- concurrent requests share one in-flight promise
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

/** Load a code theme once and notify subscribers when it becomes available. */
// oxlint-disable-next-line typescript/promise-function-async -- concurrent requests share one in-flight promise
export function requestTheme(theme: CodeThemeId): Promise<void> {
	if (highlighterInstance?.getLoadedThemes().includes(theme)) return Promise.resolve();

	const pendingLoad = themeLoadPromises.get(theme);
	if (pendingLoad) return pendingLoad;

	const themeLoad = Promise.all([getHighlighterInstance(), loadCodeTheme(theme)])
		.then(async ([highlighter, registration]) => {
			if (highlighter.getLoadedThemes().includes(theme)) return;
			await highlighter.loadTheme(registration);
			notify();
		})
		.finally(() => {
			themeLoadPromises.delete(theme);
		});
	themeLoadPromises.set(theme, themeLoad);
	return themeLoad;
}

/**
 * The chosen theme if the highlighter has it, else the mode's default while
 * the chosen one loads (subscribers are notified when it arrives).
 */
export function themeOrRequest<T extends CodeThemeId>(highlighter: HighlighterCore, theme: T, fallback: T): T {
	const usable = loadedThemeOr(highlighter, theme, fallback);
	if (usable !== theme) void requestTheme(theme);
	return usable;
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
	const codeThemes = useCodeThemes();

	// Subscribe to highlighter readiness via useSyncExternalStore.
	const highlighterVersion = useSyncExternalStore(subscribe, getVersion, () => 0);

	useEffect(() => {
		if (!language || highlighterInstance?.getLoadedLanguages().includes(language)) return;
		void requestLanguage(language);
	}, [language, highlighterVersion]);

	return useMemo(() => {
		void highlighterVersion;
		if (!highlighterInstance || !language) return null;

		const mode = resolvedTheme === "dark" ? "dark" : "light";
		const themeName = themeOrRequest(highlighterInstance, codeThemes[mode], DEFAULT_CODE_THEMES[mode]);

		try {
			const loadedLanguages = highlighterInstance.getLoadedLanguages();
			if (!loadedLanguages.includes(language)) return null;

			const result = highlighterInstance.codeToTokens(code, {
				...SHIKI_TOKENIZE_OPTIONS,
				lang: language,
				theme: themeName,
			});
			return result.tokens;
		} catch {
			return null;
		}
	}, [code, language, resolvedTheme, codeThemes, highlighterVersion]);
}
