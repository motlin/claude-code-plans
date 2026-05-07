import {useEffect, useState} from 'react';
import {renderMarkdown} from '../lib/markdown';
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
