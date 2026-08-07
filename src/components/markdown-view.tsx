import { useMemo } from "react";
import { renderInlineMarkdownToHtml } from "../lib/client-markdown";
import { MarkdownArticle } from "./markdown-article";

export function MarkdownView({ markdown }: { markdown: string }) {
  return <MarkdownArticle markdown={markdown} typographer />;
}

export function MarkdownInline({ markdown }: { markdown: string }) {
  const html = useMemo(
    () => renderInlineMarkdownToHtml(markdown, { typographer: true }),
    [markdown],
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
