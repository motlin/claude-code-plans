import type {HighlighterCore, ThemeRegistration} from "@shikijs/core";
import {z} from "zod";

/*
 * Settings ▸ Claude Code ▸ Code appearance, as on claude.ai/code: 10 light and
 * 18 dark Shiki themes. Upstream's Claude Dark has no local port yet, so the
 * dark list omits it and defaults to GitHub Dark.
 */
export const CodeThemeLightSchema = z.enum([
	"claude-light",
	"github-light",
	"pierre-light",
	"one-light",
	"catppuccin-latte",
	"solarized-light",
	"vitesse-light",
	"min-light",
	"rose-pine-dawn",
	"slack-ochin",
]);
export type CodeThemeLight = z.infer<typeof CodeThemeLightSchema>;

export const CodeThemeDarkSchema = z.enum([
	"github-dark",
	"github-dark-dimmed",
	"pierre-dark",
	"one-dark-pro",
	"dracula",
	"dracula-soft",
	"catppuccin-mocha",
	"nord",
	"solarized-dark",
	"vitesse-dark",
	"min-dark",
	"monokai",
	"tokyo-night",
	"night-owl",
	"rose-pine",
	"ayu-dark",
	"slack-dark",
]);
export type CodeThemeDark = z.infer<typeof CodeThemeDarkSchema>;

export type CodeThemeId = CodeThemeLight | CodeThemeDark;

export interface CodeThemePair {
	light: CodeThemeLight;
	dark: CodeThemeDark;
}

export const DEFAULT_CODE_THEMES: CodeThemePair = {light: "claude-light", dark: "github-dark"};

type ThemeModule = Promise<{default: ThemeRegistration}>;

type PierreTheme = (typeof import("@pierre/theme/pierre-light"))["default"];

/**
 * Pierre's themes are deeply readonly, so Shiki's registration type rejects their `tokenColors`; their
 * `semanticTokenColors` (which Shiki never reads) also nest records where Shiki's type admits only strings.
 */
function pierreTheme({semanticTokenColors: _semanticTokenColors, ...theme}: PierreTheme): ThemeRegistration {
	return {...theme, tokenColors: [...theme.tokenColors]};
}

const THEME_LOADERS: Record<CodeThemeId, () => ThemeModule> = {
	"claude-light": async () => import("./claude-light-theme").then(({claudeLight}) => ({default: claudeLight})),
	"github-light": async () => import("shiki/themes/github-light.mjs"),
	"pierre-light": async () =>
		import("@pierre/theme/pierre-light").then(({default: theme}) => ({default: pierreTheme(theme)})),
	"one-light": async () => import("shiki/themes/one-light.mjs"),
	"catppuccin-latte": async () => import("shiki/themes/catppuccin-latte.mjs"),
	"solarized-light": async () => import("shiki/themes/solarized-light.mjs"),
	"vitesse-light": async () => import("shiki/themes/vitesse-light.mjs"),
	"min-light": async () => import("shiki/themes/min-light.mjs"),
	"rose-pine-dawn": async () => import("shiki/themes/rose-pine-dawn.mjs"),
	"slack-ochin": async () => import("shiki/themes/slack-ochin.mjs"),
	"github-dark": async () => import("shiki/themes/github-dark.mjs"),
	"github-dark-dimmed": async () => import("shiki/themes/github-dark-dimmed.mjs"),
	"pierre-dark": async () =>
		import("@pierre/theme/pierre-dark").then(({default: theme}) => ({default: pierreTheme(theme)})),
	"one-dark-pro": async () => import("shiki/themes/one-dark-pro.mjs"),
	dracula: async () => import("shiki/themes/dracula.mjs"),
	"dracula-soft": async () => import("shiki/themes/dracula-soft.mjs"),
	"catppuccin-mocha": async () => import("shiki/themes/catppuccin-mocha.mjs"),
	nord: async () => import("shiki/themes/nord.mjs"),
	"solarized-dark": async () => import("shiki/themes/solarized-dark.mjs"),
	"vitesse-dark": async () => import("shiki/themes/vitesse-dark.mjs"),
	"min-dark": async () => import("shiki/themes/min-dark.mjs"),
	monokai: async () => import("shiki/themes/monokai.mjs"),
	"tokyo-night": async () => import("shiki/themes/tokyo-night.mjs"),
	"night-owl": async () => import("shiki/themes/night-owl.mjs"),
	"rose-pine": async () => import("shiki/themes/rose-pine.mjs"),
	"ayu-dark": async () => import("shiki/themes/ayu-dark.mjs"),
	"slack-dark": async () => import("shiki/themes/slack-dark.mjs"),
};

/** Imports a theme's module on demand, registered under its settings id. */
export async function loadCodeTheme(id: CodeThemeId): Promise<ThemeRegistration> {
	const module = await THEME_LOADERS[id]();
	return {...module.default, name: id};
}

/**
 * The chosen theme when the highlighter has loaded it, else the default for
 * that mode, so code keeps its colors while a newly picked theme loads.
 */
export function loadedThemeOr<T extends CodeThemeId>(
	highlighter: Pick<HighlighterCore, "getLoadedThemes">,
	theme: T,
	fallback: T,
): T {
	return theme === fallback || highlighter.getLoadedThemes().includes(theme) ? theme : fallback;
}

/** Mirrors `--font-mono` in globals.css, the fallback behind a custom code font. */
const MONO_FONT_STACK = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';

/**
 * The `--font-mono` value for Settings ▸ Code font, or null for the built-in
 * stack. Quotes and CSS punctuation are stripped so the name stays one family.
 */
export function codeFontFamily(codeFont: string): string | null {
	const name = codeFont.replace(/["'\\;{}]/g, "").trim();
	return name === "" ? null : `"${name}", ${MONO_FONT_STACK}`;
}
