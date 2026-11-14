declare module "markdown-it-footnote"
{
	import type {MarkdownIt} from "markdown-it";
	const footnote: (md: MarkdownIt) => void;
	export default footnote;
}
