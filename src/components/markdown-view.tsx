import { useMemo } from "react";
import { renderInlineMarkdownToHtml } from "../lib/client-markdown";
import { MarkdownArticle } from "./markdown-article";

export function MarkdownView({
  markdown,
  mdLinkBase,
}: {
  markdown: string;
  /** Route prefix sibling `.md` files are addressed under, e.g. `/memory/<project>`. */
  mdLinkBase?: string | undefined;
}) {
  return <MarkdownArticle markdown={markdown} typographer mdLinkBase={mdLinkBase} />;
}

export function MarkdownInline({ markdown }: { markdown: string }) {
  const html = useMemo(
    () => renderInlineMarkdownToHtml(markdown, { typographer: true }),
    [markdown],
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
