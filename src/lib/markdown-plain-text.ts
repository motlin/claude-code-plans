import MarkdownIt from "markdown-it";

type Token = ReturnType<MarkdownIt["parse"]>[number];

const parser = new MarkdownIt({html: false});

const URL_PATTERN = /\bhttps?:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"]/g;
const PATH_PATTERN = /(?<![\w/:.@-])(?:(?:~|\.{1,2})?(?:\/[\w.@-]+)+|[\w.@-]+(?:\/[\w.@-]+)+)/g;

/** Whether a slashed word reads as a file path rather than prose such as "and/or" or a "/command". */
function isPath(word: string): boolean {
	const segments = word.split("/").filter((segment) => segment !== "");
	const anchored = /^(?:~|\.{1,2})?\//.test(word);
	if (anchored) return segments.length >= 2 || /^[~.]/.test(word);
	return segments.length >= 3 || /\.[A-Za-z0-9]{1,5}$/.test(word);
}

/** Text as a listener should hear it: a URL as "link" and a file path by its file name, not character by character. */
function speakable(text: string): string {
	return text.replace(URL_PATTERN, "link").replace(PATH_PATTERN, (match) => {
		const word = match.replace(/\.+$/, "");
		if (!isPath(word)) return match;
		return `${word
			.split("/")
			.filter((segment) => segment !== "")
			.at(-1)}${match.slice(word.length)}`;
	});
}

function inlineText(token: Token, speech: boolean): string {
	return (token.children ?? [])
		.map((child) => {
			if (child.type === "softbreak" || child.type === "hardbreak") return "\n";
			if (child.type === "text" || child.type === "code_inline" || child.type === "image") {
				return speech ? speakable(child.content) : child.content;
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
	return markdownToText(markdown, false);
}

/**
 * Markdown as it should be read aloud: the plain text, with each code block
 * said as "code block", URLs as "link" and file paths by their file name.
 */
export function markdownToSpeechText(markdown: string): string {
	return markdownToText(markdown, true);
}

function markdownToText(markdown: string, speech: boolean): string {
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
				if (row !== null) row.push(inlineText(token, speech));
				else push(inlineText(token, speech));
				break;
			case "fence":
			case "code_block":
				push(speech ? "code block" : token.content.replace(/\n$/, ""));
				break;
			default:
				break;
		}
	}
	return blocks.join("");
}
