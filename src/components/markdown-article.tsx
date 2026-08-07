import { useMemo, useSyncExternalStore } from "react";
import { renderMarkdownWithHighlighting } from "../lib/client-markdown";
import {
  getHighlighterSync,
  getHighlighterVersion,
  subscribeHighlighter,
} from "../hooks/use-shiki";
import styles from "./markdown-article.module.css";

type MarkdownArticleProps =
  | { html: string; markdown?: never; typographer?: boolean }
  | { html?: never; markdown: string; typographer?: boolean };

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
    });
  }, [props.html, props.markdown, props.typographer, highlighterVersion]);

  return <article className={styles["markdown"]} dangerouslySetInnerHTML={{ __html: rendered }} />;
}
