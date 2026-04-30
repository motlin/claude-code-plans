import {useMemo, useSyncExternalStore} from 'react';
import {renderMarkdownWithHighlighting} from '../lib/client-markdown';
import {getHighlighterSync, getHighlighterVersion, subscribeHighlighter} from '../hooks/use-shiki';
import styles from './markdown-article.module.css';

type MarkdownArticleProps = {html: string; markdown?: never} | {html?: never; markdown: string};

export function MarkdownArticle(props: MarkdownArticleProps) {
	const highlighterVersion = useSyncExternalStore(subscribeHighlighter, getHighlighterVersion, () => 0);

	const rendered = useMemo(() => {
		void highlighterVersion;
		if (props.html !== undefined) return props.html;
		return renderMarkdownWithHighlighting(props.markdown!, getHighlighterSync());
	}, [props.html, props.markdown, highlighterVersion]);

	return (
		<article
			className={styles['markdown']}
			dangerouslySetInnerHTML={{__html: rendered}}
		/>
	);
}
