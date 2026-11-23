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
	/**
	 * Render as a markdown document (upstream's Plan pane): soft line breaks wrap as spaces. Mermaid fences stay code
	 * blocks, as upstream's Plan pane draws diagrams only in the Files-pane preview.
	 */
	document?: boolean | undefined;
})
{
	return <MarkdownArticle markdown={markdown} typographer mdLinkBase={mdLinkBase} document={document === true} />;
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
