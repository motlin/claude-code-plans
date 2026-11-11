import type {ITheme} from "ghostty-web";
import {useEffect, useMemo, useState} from "react";
import {useSettings} from "../components/settings-context";
import {useResolvedTheme} from "../components/theme-context";
import {type CodeFontSize, type CodeThemeId, loadCodeTheme} from "../lib/code-themes";
import {terminalBaseFromCodeTheme, terminalThemeFromCodeTheme} from "../lib/terminal-theme";

export interface TerminalThemeState {
	/** False until the stored setting and, in code-theme mode, the theme module have loaded. */
	ready: boolean;
	/** The code theme's terminal colours, or null to keep the Ghostty config's. */
	theme: ITheme | null;
	/** Settings ▸ Code font size, which replaces the Ghostty font size; null keeps Ghostty's. */
	fontSize: CodeFontSize | null;
}

type Mode = "light" | "dark";

/** Upstream's `Ee` / `Te`: each mode's Claude theme, the base other themes merge over. */
const CLAUDE_THEMES = {light: "claude-light", dark: "claude-dark"} as const satisfies Record<Mode, CodeThemeId>;

const mappedThemes = new Map<string, Promise<ITheme>>();

async function mappedTheme(mode: Mode, id: CodeThemeId): Promise<ITheme> {
	const key = `${mode}:${id}`;
	let pending = mappedThemes.get(key);
	if (pending === undefined) {
		pending = Promise.all([loadCodeTheme(CLAUDE_THEMES[mode]), loadCodeTheme(id)]).then(([base, theme]) =>
			terminalThemeFromCodeTheme(theme, terminalBaseFromCodeTheme(base)),
		);
		mappedThemes.set(key, pending);
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
		if (!loaded || !followCodeTheme) return undefined;
		let cancelled = false;
		void mappedTheme(mode, id).then((theme) => {
			if (!cancelled) setLoadedTheme({id, theme});
		});
		return () => {
			cancelled = true;
		};
	}, [mode, id, loaded, followCodeTheme]);

	const fontSize = settings.codeFontSize;
	return useMemo(() => {
		if (!loaded) return {ready: false, theme: null, fontSize};
		if (!followCodeTheme) return {ready: true, theme: null, fontSize};
		if (loadedTheme?.id !== id) return {ready: false, theme: null, fontSize};
		return {ready: true, theme: loadedTheme.theme, fontSize};
	}, [loaded, followCodeTheme, loadedTheme, id, fontSize]);
}
