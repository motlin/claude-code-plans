import type {ThemedToken} from "@shikijs/core";
import {useEffect, useMemo, useSyncExternalStore} from "react";
import {
	getHighlighterSync,
	getHighlighterVersion,
	requestLanguage,
	requestTheme,
	subscribeHighlighter,
} from "../../hooks/use-shiki";
import type {CodeThemeId} from "../../lib/code-themes";
import {SHIKI_TOKENIZE_OPTIONS} from "../../lib/shiki-tokenize-options";

/** Upstream's Code appearance sample: one line removed, one added. */
const PREVIEW_LINES = [
	{number: 1, sign: " ", text: "function greet(name: string) {"},
	{number: 2, sign: "-", text: '  return "Hello, " + name;'},
	{number: 2, sign: "+", text: "  return `Hello, ${name}!`;"},
	{number: 3, sign: " ", text: "}"},
] as const;

const PREVIEW_CODE = PREVIEW_LINES.map((line) => line.text).join("\n");

const ROW_TINT = {
	" ": "",
	"-": "bg-[color-mix(in_srgb,var(--upstream-extended-pink)_18%,transparent)]",
	"+": "bg-[color-mix(in_srgb,var(--upstream-extended-green)_18%,transparent)]",
} as const;

interface HighlightedPreview {
	bg: string | undefined;
	fg: string | undefined;
	lines: ThemedToken[][] | null;
}

function useHighlightedPreview(theme: CodeThemeId): HighlightedPreview {
	const highlighterVersion = useSyncExternalStore(subscribeHighlighter, getHighlighterVersion, () => 0);

	useEffect(() => {
		void requestLanguage("typescript");
		void requestTheme(theme);
	}, [theme]);

	return useMemo(() => {
		void highlighterVersion;
		const highlighter = getHighlighterSync();
		if (
			highlighter === null ||
			!highlighter.getLoadedThemes().includes(theme) ||
			!highlighter.getLoadedLanguages().includes("typescript")
		) {
			return {bg: undefined, fg: undefined, lines: null};
		}
		const result = highlighter.codeToTokens(PREVIEW_CODE, {
			...SHIKI_TOKENIZE_OPTIONS,
			lang: "typescript",
			theme,
		});
		return {bg: result.bg, fg: result.fg, lines: result.tokens};
	}, [theme, highlighterVersion]);
}

/** A live 3-line diff card rendered in `theme`, shown under its picker. */
export function CodeThemePreview({theme, label}: {theme: CodeThemeId; label: string}) {
	const {bg, fg, lines} = useHighlightedPreview(theme);

	return (
		<figure
			aria-label={label}
			data-code-theme={theme}
			style={{backgroundColor: bg, color: fg}}
			className="m-0 overflow-hidden rounded-r6 border border-border py-2 font-mono text-code leading-5"
		>
			{PREVIEW_LINES.map((line, index) => (
				<div key={index} className={`flex whitespace-pre ${ROW_TINT[line.sign]}`}>
					<span className="w-8 shrink-0 pr-2 text-right opacity-50 select-none">{line.number}</span>
					<span aria-hidden="true" className="w-4 shrink-0 select-none">
						{line.sign === " " ? "" : line.sign}
					</span>
					<span className="min-w-0 pr-3">
						{lines?.[index]?.map((token, tokenIndex) => (
							<span key={tokenIndex} style={{color: token.color}}>
								{token.content}
							</span>
						)) ?? line.text}
					</span>
				</div>
			))}
		</figure>
	);
}
