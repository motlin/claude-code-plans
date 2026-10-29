import {useMemo} from "react";
import {renderInlineMarkdownToHtml} from "../lib/client-markdown";
import {MarkdownArticle} from "./markdown-article";

export function MarkdownView({
	markdown,
	mdLinkBase,
	document,
}: {
	markdown: string;
	/** Route prefix sibling `.md` files are addressed under, e.g. `/memory/<project>`. */
	mdLinkBase?: string | undefined;
	/** Render as a markdown document, where soft line breaks wrap as spaces (upstream's Plan pane). */
	document?: boolean | undefined;
}) {
	return <MarkdownArticle markdown={markdown} typographer mdLinkBase={mdLinkBase} document={document} />;
}

export function MarkdownInline({markdown}: {markdown: string}) {
	const html = useMemo(() => renderInlineMarkdownToHtml(markdown, {typographer: true}), [markdown]);
	return <span dangerouslySetInnerHTML={{__html: html}} />;
}
