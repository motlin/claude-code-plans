import {useEffect, useState} from 'react';
import {renderInlineMarkdown, renderMarkdown} from '../lib/markdown';
import styles from './markdown-article.module.css';

/**
 * Drop-in markdown render component. Lazy-loads Shiki + MarkdownIt on first
 * render via {@link renderMarkdown}. Until the lazy chunk resolves (and as a
 * permanent fallback when offline), renders the raw markdown inside a
 * `<pre>` block. Same CSS module as `MarkdownArticle` for visual parity.
 */
export function MarkdownView({markdown}: {markdown: string}) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		renderMarkdown(markdown).then(
			(rendered) => {
				if (!cancelled) setHtml(rendered);
			},
			() => {
				// Highlighter failed to load (e.g. offline). Keep the raw <pre>
				// fallback rather than showing an error state.
			},
		);
		return () => {
			cancelled = true;
		};
	}, [markdown]);

	if (html == null) {
		return <pre className="whitespace-pre-wrap font-sans text-sm">{markdown}</pre>;
	}
	return (
		<article
			className={styles['markdown']}
			dangerouslySetInnerHTML={{__html: html}}
		/>
	);
}

/**
 * Inline variant of {@link MarkdownView}. Renders short markdown snippets
 * (e.g. task subjects) without paragraph wrapping. While the lazy renderer
 * loads, falls back to the raw text inside a `<span>`.
 */
export function MarkdownInline({markdown}: {markdown: string}) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		renderInlineMarkdown(markdown).then(
			(rendered) => {
				if (!cancelled) setHtml(rendered);
			},
			() => {
				// Highlighter failed to load; keep the raw fallback.
			},
		);
		return () => {
			cancelled = true;
		};
	}, [markdown]);

	if (html == null) {
		return <span>{markdown}</span>;
	}
	return <span dangerouslySetInnerHTML={{__html: html}} />;
}
