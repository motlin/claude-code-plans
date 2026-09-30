import {useMemo} from "react";
import {useSettings} from "../components/settings-provider";
import type {CodeThemePair} from "../lib/code-themes";

/**
 * The light/dark code theme pair from Settings ▸ Code appearance. Every
 * highlighter (markdown fences, token views, tool diffs, the Changes pane)
 * reads it here; each asks the shared Shiki highlighter to load a theme it
 * has not seen yet and uses the default until it arrives.
 */
export function useCodeThemes(): CodeThemePair {
	const {settings} = useSettings();
	const light = settings.codeThemeLight;
	const dark = settings.codeThemeDark;
	return useMemo(() => ({light, dark}), [light, dark]);
}
