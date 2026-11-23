import {useEffect, useMemo, useState} from "react";
import {type CodeThemeId, loadCodeTheme} from "../lib/code-themes";
import {codeThemeVars, selectionMatchColor} from "../lib/code-theme-vars";
import {useCodeThemes} from "./use-code-themes";

/** Upstream c6e73333a `S` before both code themes have loaded. */
export const CODE_THEME_BG_FALLBACK =
	"light-dark(var(--code-theme-light-bg, var(--upstream-surface-2)), var(--code-theme-dark-bg, var(--upstream-surface-2)))";

interface LoadedTheme
{
	bg: string | undefined;
	colors: Readonly<Record<string, string>>;
}

/** Each loaded theme's colours, so later diffs read them synchronously. */
const loadedThemes = new Map<CodeThemeId, LoadedTheme>();

async function loadTheme(id: CodeThemeId): Promise<void>
{
	if (loadedThemes.has(id)) return;
	const theme = await loadCodeTheme(id);
	const colors = theme.colors ?? {};
	loadedThemes.set(
		id,
		{
			// Upstream c6e73333a `y`: `colors["editor.background"] ?? bg`.
			bg: colors["editor.background"] ?? theme.bg,
			colors,
		},
	);
}

/** The chosen light and dark code themes once both have loaded, re-rendering when they arrive. */
function useLoadedCodeThemePair():
	|
	  {
			light: LoadedTheme;
			dark: LoadedTheme;
	  }
	| undefined
{
	const {light, dark} = useCodeThemes();
	const [, setVersion] = useState(0);

	useEffect(() =>
	{
		if (loadedThemes.has(light) && loadedThemes.has(dark)) return undefined;
		let cancelled = false;
		void Promise.all([loadTheme(light), loadTheme(dark)]).then(() =>
		{
			if (!cancelled) setVersion((version) => version + 1);
		});
		return () =>
		{
			cancelled = true;
		};
	}, [light, dark]);

	const lightTheme = loadedThemes.get(light);
	const darkTheme = loadedThemes.get(dark);
	return lightTheme === undefined || darkTheme === undefined
		? undefined
		:
			{
				light: lightTheme,
				dark: darkTheme,
			};
}

/**
 * The Changes pane's diff background (upstream c6e73333a `S`): `light-dark()` of the chosen code themes'
 * editor backgrounds once both have loaded. Upstream's injected `Ea` replaces pierre's theme background with
 * the host's `--cds-filediff-bg`, so the Changes pane must hand the theme background back explicitly.
 */
export function useCodeThemeBackground(): string
{
	const pair = useLoadedCodeThemePair();
	const light = pair?.light.bg;
	const dark = pair?.dark.bg;
	return light === undefined || dark === undefined ? CODE_THEME_BG_FALLBACK : `light-dark(${light}, ${dark})`;
}

/**
 * Upstream c6e73333a `A`'s `--code-theme-selection-match-bg`: `light-dark()` of the chosen code themes'
 * selection-match colours, or undefined until both have loaded (the occurrence rule then falls back).
 */
export function useCodeThemeSelectionMatch(): string | undefined
{
	const pair = useLoadedCodeThemePair();
	return pair === undefined
		? undefined
		: `light-dark(${selectionMatchColor(pair.light.colors, "light")}, ${selectionMatchColor(pair.dark.colors, "dark")})`;
}

/**
 * Upstream c6e73333a `v`: the code-theme custom properties (backgrounds, git, selection, line-number and
 * find-match colours) for the chosen light and dark themes, or undefined until both have loaded.
 */
export function useCodeThemeVars(): Record<string, string> | undefined
{
	const pair = useLoadedCodeThemePair();
	const light = pair?.light;
	const dark = pair?.dark;
	return useMemo(() =>
	{
		if (light?.bg === undefined || dark?.bg === undefined) return undefined;
		return codeThemeVars(
			{
				bg: light.bg,
				colors: light.colors,
			},
			{
				bg: dark.bg,
				colors: dark.colors,
			},
		);
	}, [light, dark]);
}
