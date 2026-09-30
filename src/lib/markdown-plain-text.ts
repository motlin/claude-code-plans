import MarkdownIt from "markdown-it";

type Token = ReturnType<MarkdownIt["parse"]>[number];

const parser = new MarkdownIt({html: false});

function inlineText(token: Token): string {
	return (token.children ?? [])
		.map((child) => {
			if (child.type === "softbreak" || child.type === "hardbreak") return "\n";
			if (child.type === "text" || child.type === "code_inline" || child.type === "image") {
				return child.content;
			}
			return "";
		})
		.join("");
}

/**
 * Markdown as the text a reader sees: markers, link targets and fences are
 * dropped, blocks are separated by a blank line, list items and table rows by
 * a newline, and table cells by a tab.
 */
export function markdownToPlainText(markdown: string): string {
	const blocks: string[] = [];
	let listDepth = 0;
	let row: string[] | null = null;
	let tableRows: string[] | null = null;
	let joinTight = false;

	function push(text: string): void {
		if (blocks.length > 0 && joinTight) blocks.push("\n");
		else if (blocks.length > 0) blocks.push("\n\n");
		blocks.push(text);
		joinTight = listDepth > 0;
	}

	for (const token of parser.parse(markdown, {})) {
		switch (token.type) {
			case "bullet_list_open":
			case "ordered_list_open":
				listDepth++;
				break;
			case "bullet_list_close":
			case "ordered_list_close":
				listDepth--;
				if (listDepth === 0) joinTight = false;
				break;
			case "table_open":
				tableRows = [];
				break;
			case "tr_open":
				row = [];
				break;
			case "tr_close":
				tableRows?.push((row ?? []).join("\t"));
				row = null;
				break;
			case "table_close":
				push((tableRows ?? []).join("\n"));
				tableRows = null;
				break;
			case "inline":
				if (row !== null) row.push(inlineText(token));
				else push(inlineText(token));
				break;
			case "fence":
			case "code_block":
				push(token.content.replace(/\n$/, ""));
				break;
			default:
				break;
		}
	}
	return blocks.join("");
}
