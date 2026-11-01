import type {ThemedToken} from "@shikijs/core";
import {useEffect, useMemo, useState, useSyncExternalStore} from "react";
import {useResolvedTheme} from "../components/theme-context";
import {DEFAULT_CODE_THEMES} from "../lib/code-themes";
import {SHIKI_TOKENIZE_OPTIONS} from "../lib/shiki-tokenize-options";
import {useCodeThemes} from "./use-code-themes";

type ShikiModule = typeof import("./use-shiki");

const subscribeNothing = () => () => undefined;
const versionZero = () => 0;

/**
 * Shiki's bash tokens for the composer's bash-mode command, in the code theme (upstream `epitaxyBashHighlight`).
 * The shared highlighter loads only once bash mode first turns on, so the composer's bundle never carries Shiki.
 * Null while disabled or while the highlighter and grammar load.
 */
export function useBashHighlight(code: string, enabled: boolean): ThemedToken[][] | null {
	const [shiki, setShiki] = useState<ShikiModule | null>(null);
	const resolvedTheme = useResolvedTheme();
	const codeThemes = useCodeThemes();
	const version = useSyncExternalStore(
		shiki?.subscribeHighlighter ?? subscribeNothing,
		shiki?.getHighlighterVersion ?? versionZero,
		versionZero,
	);

	useEffect(() => {
		let live = true;
		if (enabled && shiki === null) {
			void import("./use-shiki").then((module) => {
				if (live) setShiki(() => module);
			});
		}
		return () => {
			live = false;
		};
	}, [enabled, shiki]);

	useEffect(() => {
		if (enabled && shiki !== null) void shiki.requestLanguage("bash");
	}, [enabled, shiki]);

	return useMemo(() => {
		void version;
		const highlighter = shiki?.getHighlighterSync() ?? null;
		if (!enabled || shiki === null || highlighter === null) return null;
		if (!highlighter.getLoadedLanguages().includes("bash")) return null;
		const mode = resolvedTheme === "dark" ? "dark" : "light";
		const theme = shiki.themeOrRequest(highlighter, codeThemes[mode], DEFAULT_CODE_THEMES[mode]);
		try {
			return highlighter.codeToTokens(code, {...SHIKI_TOKENIZE_OPTIONS, lang: "bash", theme}).tokens;
		} catch {
			return null;
		}
	}, [code, enabled, shiki, resolvedTheme, codeThemes, version]);
}
