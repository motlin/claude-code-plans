import {useMemo, useSyncExternalStore} from "react";
import {renderMarkdownWithHighlighting} from "../../lib/client-markdown";
import {getHighlighterSync, getHighlighterVersion, subscribeHighlighter} from "../../hooks/use-shiki";
import {useCodeThemes} from "../../hooks/use-code-themes";
import {handleCodeCopyClick} from "../../lib/code-copy";
import markdownStyles from "../markdown-article.module.css";

/**
 * Markdown for KeyValueCard param values and generic tool bodies, with Shiki-highlighted fences.
 * Memoizes the HTML output to avoid re-rendering on every parent render.
 */
export function InlineMarkdown({text, headingsUnder}: {text: string; headingsUnder?: number | undefined}) {
	const highlighterVersion = useSyncExternalStore(subscribeHighlighter, getHighlighterVersion, () => 0);
	const codeThemes = useCodeThemes();
	const html = useMemo(() => {
		void highlighterVersion;
		return renderMarkdownWithHighlighting(text, getHighlighterSync(), {
			codeThemes,
			...(headingsUnder !== undefined && {headingsUnder}),
		});
	}, [text, codeThemes, highlighterVersion, headingsUnder]);
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegates clicks from the rendered links and copy buttons inside it, which are keyboard-reachable themselves
		<div
			className={markdownStyles["markdown"]}
			onClick={handleCodeCopyClick}
			dangerouslySetInnerHTML={{__html: html}}
		/>
	);
}
