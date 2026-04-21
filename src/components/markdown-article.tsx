import {useMemo} from 'react';
import {renderMarkdownToHtml} from '../lib/client-markdown';
import styles from './markdown-article.module.css';

type MarkdownArticleProps = {html: string; markdown?: never} | {html?: never; markdown: string};

export function MarkdownArticle(props: MarkdownArticleProps) {
	const rendered = useMemo(() => {
		if ('html' in props && props.html !== undefined) return props.html;
		return renderMarkdownToHtml(props.markdown!);
	}, [props.html, props.markdown]);

	return (
		<article
			className={styles['markdown']}
			dangerouslySetInnerHTML={{__html: rendered}}
		/>
	);
}
