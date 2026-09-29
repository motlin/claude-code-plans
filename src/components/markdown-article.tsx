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
import { useCodeThemes } from "../hooks/use-code-themes";
import { handleCodeCopyClick } from "../lib/code-copy";
import styles from "./markdown-article.module.css";

interface FileRefProps {
  /** Inline code rendered as clickable file refs, keyed by the code's text. */
  fileRefs?: ReadonlyMap<string, FileRef> | undefined;
  onFileRef?: ((ref: FileRef) => void) | undefined;
  /** Artifacts-index titles keyed by artifact id, for claude.ai artifact link cards. */
  artifactTitles?: ReadonlyMap<string, string> | undefined;
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

  const codeThemes = useCodeThemes();

  const rendered = useMemo(() => {
    void highlighterVersion;
    if (props.html !== undefined) return props.html;
    return renderMarkdownWithHighlighting(props.markdown!, getHighlighterSync(), {
      typographer: props.typographer ?? false,
      codeThemes,
      ...(props.mdLinkBase === undefined ? {} : { mdLinkBase: props.mdLinkBase }),
      ...(props.fileRefs === undefined ? {} : { fileRefs: props.fileRefs }),
      ...(props.artifactTitles === undefined ? {} : { artifactTitles: props.artifactTitles }),
    });
  }, [
    props.html,
    props.markdown,
    props.typographer,
    props.mdLinkBase,
    props.fileRefs,
    props.artifactTitles,
    codeThemes,
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
