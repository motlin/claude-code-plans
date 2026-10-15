import type {FileOptions} from "@pierre/diffs/react";
import {File} from "@pierre/diffs/react";
import {useMemo} from "react";
import {bundledLanguages} from "shiki";

import {useCodeThemes} from "../hooks/use-code-themes";
import {INLINE_DIFFS_STYLE_OVERRIDES} from "./changes/diffs-config";
import {useResolvedTheme} from "./theme-context";

/** Upstream's `unsafeCSS` for a user message's code snippet. */
const SNIPPET_CSS =
	'[data-file]{letter-spacing: calc(round(up, 1ch, 1px / 64) - 1ch); font-feature-settings: "liga","clig","calt";} [data-line]{min-height:1lh} [data-line]:hover{background:transparent} [data-code]{overflow:clip; padding-bottom:var(--diffs-gap-block, var(--diffs-gap-fallback))}';

/** Upstream falls back to plain text for a language its highlighter does not bundle. */
function snippetLanguage(lang: string): string {
	const lower = lang.toLowerCase();
	return lower in bundledLanguages ? lower : "text";
}

/** A ``` fence in a user message, drawn as upstream does: a headerless, unnumbered @pierre/diffs file. */
export function UserCodeBlock({code, lang}: {code: string; lang: string}) {
	const themeType = useResolvedTheme();
	const theme = useCodeThemes();
	const language = snippetLanguage(lang);
	const file = useMemo(
		() => ({name: "snippet", contents: code, lang: language, cacheKey: `user:${language}:${code}`}),
		[code, language],
	);
	const options = useMemo<FileOptions<undefined, undefined>>(
		() => ({
			theme,
			themeType,
			disableFileHeader: true,
			disableLineNumbers: true,
			overflow: "wrap",
			unsafeCSS: SNIPPET_CSS,
		}),
		[theme, themeType],
	);
	return <File file={file} options={options} style={INLINE_DIFFS_STYLE_OVERRIDES} disableWorkerPool />;
}
