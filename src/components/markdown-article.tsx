import { useMemo, useSyncExternalStore } from "react";
import { renderMarkdownWithHighlighting } from "../lib/client-markdown";
import {
  getHighlighterSync,
  getHighlighterVersion,
  subscribeHighlighter,
} from "../hooks/use-shiki";
import { handleCodeCopyClick } from "../lib/code-copy";
import styles from "./markdown-article.module.css";

type MarkdownArticleProps =
  | { html: string; markdown?: never; typographer?: boolean; mdLinkBase?: string | undefined }
  | { html?: never; markdown: string; typographer?: boolean; mdLinkBase?: string | undefined };

export function MarkdownArticle(props: MarkdownArticleProps) {
  const highlighterVersion = useSyncExternalStore(
    subscribeHighlighter,
    getHighlighterVersion,
    () => 0,
  );

  const rendered = useMemo(() => {
    void highlighterVersion;
    if (props.html !== undefined) return props.html;
    return renderMarkdownWithHighlighting(props.markdown!, getHighlighterSync(), {
      typographer: props.typographer ?? false,
      ...(props.mdLinkBase === undefined ? {} : { mdLinkBase: props.mdLinkBase }),
    });
  }, [props.html, props.markdown, props.typographer, props.mdLinkBase, highlighterVersion]);

  return (
    <article
      className={styles["markdown"]}
      onClick={handleCodeCopyClick}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}
