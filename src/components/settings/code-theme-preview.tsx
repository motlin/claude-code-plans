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

/** Upstream's Code appearance sample: one line removed, one added, each with its changed word. */
const PREVIEW_LINES = [
	{number: 1, sign: " ", text: "function greet(name: string) {", word: ""},
	{number: 2, sign: "-", text: '  return "Hello, " + name;', word: '" +'},
	{number: 2, sign: "+", text: "  return `Hello, ${name}!`;", word: "${name}!"},
	{number: 3, sign: " ", text: "}", word: ""},
] as const;

const PREVIEW_CODE = PREVIEW_LINES.map((line) => line.text).join("\n");

const ROW_TINT = {
	" ": "",
	"-": "bg-[color-mix(in_srgb,var(--upstream-git-removed)_18%,transparent)]",
	"+": "bg-[color-mix(in_srgb,var(--upstream-git-added)_18%,transparent)]",
} as const;

const NUMBER_TINT = {
	" ": "opacity-50",
	"-": "text-[var(--upstream-git-removed)]",
	"+": "text-[var(--upstream-git-added)]",
} as const;

const WORD_TINT = {
	" ": "",
	"-": "bg-[color-mix(in_srgb,var(--upstream-git-removed)_30%,transparent)]",
	"+": "bg-[color-mix(in_srgb,var(--upstream-git-added)_30%,transparent)]",
} as const;

interface Segment {
	content: string;
	color?: string | undefined;
}

/** Splits a line's tokens into the runs before, inside and after its changed word. */
function splitAtWord(tokens: readonly Segment[], text: string, word: string): [Segment[], Segment[], Segment[]] {
	const start = word === "" ? text.length : text.indexOf(word);
	const end = start + word.length;
	const before: Segment[] = [];
	const inside: Segment[] = [];
	const after: Segment[] = [];
	let offset = 0;
	for (const token of tokens) {
		const clamp = (at: number) => Math.min(Math.max(at - offset, 0), token.content.length);
		const push = (into: Segment[], from: number, to: number) => {
			const content = token.content.slice(from, to);
			if (content !== "") {
				into.push({content, color: token.color});
			}
		};
		push(before, 0, clamp(start));
		push(inside, clamp(start), clamp(end));
		push(after, clamp(end), token.content.length);
		offset += token.content.length;
	}
	return [before, inside, after];
}

function renderSegments(segments: readonly Segment[]) {
	return segments.map((segment, index) => (
		<span key={index} style={{color: segment.color}}>
			{segment.content}
		</span>
	));
}

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
		<div className="min-h-[94px] overflow-clip rounded-lg border">
			<figure
				aria-label={label}
				data-code-theme={theme}
				style={{backgroundColor: bg, color: fg}}
				className="m-0 min-h-[94px] py-2 font-mono text-code leading-5"
			>
				{PREVIEW_LINES.map((line, index) => {
					const [before, word, after] = splitAtWord(
						lines?.[index] ?? [{content: line.text, color: undefined}],
						line.text,
						line.word,
					);
					return (
						<div key={index} className={`flex whitespace-pre ${ROW_TINT[line.sign]}`}>
							<span className={`w-8 shrink-0 pr-2 text-right ${NUMBER_TINT[line.sign]} select-none`}>
								{line.number}
							</span>
							<span aria-hidden="true" className="w-4 shrink-0 select-none">
								{line.sign === " " ? "" : line.sign}
							</span>
							<span className="min-w-0 pr-3">
								{renderSegments(before)}
								{word.length > 0 && (
									<span data-diff-word className={WORD_TINT[line.sign]}>
										{renderSegments(word)}
									</span>
								)}
								{renderSegments(after)}
							</span>
						</div>
					);
				})}
			</figure>
		</div>
	);
}
