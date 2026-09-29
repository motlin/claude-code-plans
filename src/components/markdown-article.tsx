import { type KeyboardEvent, type MouseEvent, useMemo, useSyncExternalStore } from "react";
import {
  FILE_REF_ATTR,
  fileRefFromElement,
  renderMarkdownWithHighlighting,
} from "../lib/client-markdown";
import type { FileRef } from "../lib/file-refs";
import {
  getHighlighterSync,
  getHighlighterVersion,
  subscribeHighlighter,
} from "../hooks/use-shiki";
import { handleCodeCopyClick } from "../lib/code-copy";
import styles from "./markdown-article.module.css";

interface FileRefProps {
  /** Inline code rendered as clickable file refs, keyed by the code's text. */
  fileRefs?: ReadonlyMap<string, FileRef> | undefined;
  onFileRef?: ((ref: FileRef) => void) | undefined;
}

type MarkdownArticleProps = FileRefProps &
  (
    | { html: string; markdown?: never; typographer?: boolean; mdLinkBase?: string | undefined }
    | { html?: never; markdown: string; typographer?: boolean; mdLinkBase?: string | undefined }
  );

function targetFileRef(event: MouseEvent | KeyboardEvent): FileRef | null {
  const element = (event.target as Element).closest(`[${FILE_REF_ATTR}]`);
  return element === null ? null : fileRefFromElement(element);
}

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
      ...(props.fileRefs === undefined ? {} : { fileRefs: props.fileRefs }),
    });
  }, [
    props.html,
    props.markdown,
    props.typographer,
    props.mdLinkBase,
    props.fileRefs,
    highlighterVersion,
  ]);

  const { onFileRef } = props;
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    const ref = onFileRef === undefined ? null : targetFileRef(event);
    if (ref === null) handleCodeCopyClick(event);
    else onFileRef?.(ref);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (onFileRef === undefined || (event.key !== "Enter" && event.key !== " ")) return;
    const ref = targetFileRef(event);
    if (ref === null) return;
    event.preventDefault();
    onFileRef(ref);
  };

  return (
    <article
      className={styles["markdown"]}
      onClick={handleClick}
      {...(onFileRef === undefined ? {} : { onKeyDown: handleKeyDown })}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}
