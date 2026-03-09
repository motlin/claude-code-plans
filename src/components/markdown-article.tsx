import styles from './markdown-article.module.css';

export function MarkdownArticle({html}: {html: string}) {
	return (
		<article
			className={styles['markdown']}
			dangerouslySetInnerHTML={{__html: html}}
		/>
	);
}
