import type {ITheme} from "ghostty-web";
import {useEffect, useMemo, useState} from "react";
import {useSettings} from "../components/settings-provider";
import {useResolvedTheme} from "../components/theme-provider";
import {type CodeThemeId, loadCodeTheme} from "../lib/code-themes";
import {terminalThemeFromCodeTheme} from "../lib/terminal-theme";

export interface TerminalThemeState {
	/** False until the stored setting and, in code-theme mode, the theme module have loaded. */
	ready: boolean;
	/** The code theme's terminal colours, or null to keep the Ghostty config's. */
	theme: ITheme | null;
}

const NOT_READY: TerminalThemeState = {ready: false, theme: null};
const GHOSTTY: TerminalThemeState = {ready: true, theme: null};

const mappedThemes = new Map<CodeThemeId, Promise<ITheme>>();

function mappedTheme(id: CodeThemeId): Promise<ITheme> {
	let pending = mappedThemes.get(id);
	if (pending === undefined) {
		pending = loadCodeTheme(id).then(terminalThemeFromCodeTheme);
		mappedThemes.set(id, pending);
	}
	return pending;
}

/**
 * The colours terminals are built with. By default they follow the code
 * theme for the page's resolved light/dark mode, like claude.ai/code;
 * Settings ▸ Terminal colors ▸ Ghostty keeps the local Ghostty palette.
 */
export function useTerminalTheme(): TerminalThemeState {
	const {settings, loaded} = useSettings();
	const mode = useResolvedTheme();
	const id: CodeThemeId = mode === "dark" ? settings.codeThemeDark : settings.codeThemeLight;
	const followCodeTheme = settings.terminalAppearance === "code-theme";
	const [loadedTheme, setLoadedTheme] = useState<{id: CodeThemeId; theme: ITheme} | null>(null);

	useEffect(() => {
		if (!loaded || !followCodeTheme) return;
		let cancelled = false;
		void mappedTheme(id).then((theme) => {
			if (!cancelled) setLoadedTheme({id, theme});
		});
		return () => {
			cancelled = true;
		};
	}, [id, loaded, followCodeTheme]);

	return useMemo(() => {
		if (!loaded) return NOT_READY;
		if (!followCodeTheme) return GHOSTTY;
		if (loadedTheme?.id !== id) return NOT_READY;
		return {ready: true, theme: loadedTheme.theme};
	}, [loaded, followCodeTheme, loadedTheme, id]);
}
