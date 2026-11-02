import {useEffect, useState} from "react";
import {type CodeThemeId, loadCodeTheme} from "../lib/code-themes";
import {useCodeThemes} from "./use-code-themes";

/** Upstream c6e73333a `S` before both code themes have loaded. */
export const CODE_THEME_BG_FALLBACK =
	"light-dark(var(--code-theme-light-bg, var(--cds-surface-2)), var(--code-theme-dark-bg, var(--cds-surface-2)))";

/** Each loaded theme's editor background, so later diffs read it synchronously. */
const loadedBackgrounds = new Map<CodeThemeId, string>();

async function themeBackground(id: CodeThemeId): Promise<void>
{
	if (loadedBackgrounds.has(id)) return;
	const theme = await loadCodeTheme(id);
	// Upstream c6e73333a `y`: `colors["editor.background"] ?? bg`.
	const bg = theme.colors?.["editor.background"] ?? theme.bg;
	if (bg !== undefined) loadedBackgrounds.set(id, bg);
}

function pairBackground(light: string | undefined, dark: string | undefined): string
{
	return light === undefined || dark === undefined ? CODE_THEME_BG_FALLBACK : `light-dark(${light}, ${dark})`;
}

/**
 * The Changes pane's diff background (upstream c6e73333a `S`): `light-dark()` of the chosen code themes'
 * editor backgrounds once both have loaded. Upstream's injected `Ea` replaces pierre's theme background with
 * the host's `--cds-filediff-bg`, so the Changes pane must hand the theme background back explicitly.
 */
export function useCodeThemeBackground(): string
{
	const {light, dark} = useCodeThemes();
	const [, setVersion] = useState(0);

	useEffect(() =>
	{
		if (loadedBackgrounds.has(light) && loadedBackgrounds.has(dark)) return undefined;
		let cancelled = false;
		void Promise.all([themeBackground(light), themeBackground(dark)]).then(() =>
		{
			if (!cancelled) setVersion((version) => version + 1);
		});
		return () =>
		{
			cancelled = true;
		};
	}, [light, dark]);

	return pairBackground(loadedBackgrounds.get(light), loadedBackgrounds.get(dark));
}
