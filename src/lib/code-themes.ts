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

type ThemeModule = Promise<{default: unknown}>;

const THEME_LOADERS: Record<CodeThemeId, () => ThemeModule> = {
	"claude-light": () => import("./claude-light-theme").then(({claudeLight}) => ({default: claudeLight})),
	"github-light": () => import("shiki/themes/github-light.mjs"),
	"pierre-light": () => import("@pierre/theme/pierre-light"),
	"one-light": () => import("shiki/themes/one-light.mjs"),
	"catppuccin-latte": () => import("shiki/themes/catppuccin-latte.mjs"),
	"solarized-light": () => import("shiki/themes/solarized-light.mjs"),
	"vitesse-light": () => import("shiki/themes/vitesse-light.mjs"),
	"min-light": () => import("shiki/themes/min-light.mjs"),
	"rose-pine-dawn": () => import("shiki/themes/rose-pine-dawn.mjs"),
	"slack-ochin": () => import("shiki/themes/slack-ochin.mjs"),
	"github-dark": () => import("shiki/themes/github-dark.mjs"),
	"github-dark-dimmed": () => import("shiki/themes/github-dark-dimmed.mjs"),
	"pierre-dark": () => import("@pierre/theme/pierre-dark"),
	"one-dark-pro": () => import("shiki/themes/one-dark-pro.mjs"),
	dracula: () => import("shiki/themes/dracula.mjs"),
	"dracula-soft": () => import("shiki/themes/dracula-soft.mjs"),
	"catppuccin-mocha": () => import("shiki/themes/catppuccin-mocha.mjs"),
	nord: () => import("shiki/themes/nord.mjs"),
	"solarized-dark": () => import("shiki/themes/solarized-dark.mjs"),
	"vitesse-dark": () => import("shiki/themes/vitesse-dark.mjs"),
	"min-dark": () => import("shiki/themes/min-dark.mjs"),
	monokai: () => import("shiki/themes/monokai.mjs"),
	"tokyo-night": () => import("shiki/themes/tokyo-night.mjs"),
	"night-owl": () => import("shiki/themes/night-owl.mjs"),
	"rose-pine": () => import("shiki/themes/rose-pine.mjs"),
	"ayu-dark": () => import("shiki/themes/ayu-dark.mjs"),
	"slack-dark": () => import("shiki/themes/slack-dark.mjs"),
};

/** Imports a theme's module on demand, registered under its settings id. */
export async function loadCodeTheme(id: CodeThemeId): Promise<ThemeRegistration> {
	const module = await THEME_LOADERS[id]();
	return {...(module.default as ThemeRegistration), name: id};
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
const MONO_FONT_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace';

/**
 * The `--font-mono` value for Settings ▸ Code font, or null for the built-in
 * stack. Quotes and CSS punctuation are stripped so the name stays one family.
 */
export function codeFontFamily(codeFont: string): string | null {
	const name = codeFont.replace(/["'\\;{}]/g, "").trim();
	return name === "" ? null : `"${name}", ${MONO_FONT_STACK}`;
}
