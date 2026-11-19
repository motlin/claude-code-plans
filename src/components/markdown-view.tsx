import {useMemo} from "react";
import {renderInlineMarkdownToHtml} from "../lib/client-markdown";
import {DocumentDiagrams} from "./diagram-lightbox";
import {MarkdownArticle} from "./markdown-article";

export function MarkdownView({
	markdown,
	mdLinkBase,
	document,
}: {
	markdown: string;
	/** Route prefix sibling `.md` files are addressed under, e.g. `/memory/<project>`. */
	mdLinkBase?: string | undefined;
	/**
	 * Render as a markdown document (upstream's Plan pane): soft line breaks wrap as spaces, and mermaid fences draw
	 * as diagrams that expand into a lightbox.
	 */
	document?: boolean | undefined;
})
{
	if (document !== true) return <MarkdownArticle markdown={markdown} typographer mdLinkBase={mdLinkBase} />;
	return (
		<DocumentDiagrams>
			<MarkdownArticle markdown={markdown} typographer mdLinkBase={mdLinkBase} document diagrams />
		</DocumentDiagrams>
	);
}

export function MarkdownInline({markdown}: {markdown: string})
{
	const html = useMemo(
		() =>
			renderInlineMarkdownToHtml(
				markdown,
				{
					typographer: true,
				},
			),
		[markdown],
	);
	return (
		<span
			dangerouslySetInnerHTML={
			{
				__html: html,
			}}
		/>
	);
}
