/** A context snippet a sent prompt carried as an `<!-- attach -->` quote block. */
export interface AttachSnippet {
	text: string;
	label?: string;
	terminalTabId?: string;
}

/** Upstream's codec `Ne`: an attach marker line followed by its `> ` quote lines. */
const ATTACH_BLOCK_RE = /^<!-- attach(?:: (.*?))?(?: \| tab:(\S+))? -->\n((?:>(?: |$).*\n?)+)\n*/gm;

function unquote(quote: string): string {
	return quote
		.split("\n")
		.map((line) => line.replace(/^> ?/, ""))
		.join("\n")
		.trim();
}

/**
 * Upstream's codec `B`: strips each `<!-- attach -->` block into a snippet
 * (dropping empty ones) and returns the trimmed remaining prompt.
 */
export function parseAttachSnippets(text: string): {snippets: AttachSnippet[]; rest: string} {
	if (!text.includes("<!-- attach")) return {snippets: [], rest: text.trim()};
	const snippets: AttachSnippet[] = [];
	const rest = text.replace(
		ATTACH_BLOCK_RE,
		(_match: string, label: string | undefined, tab: string | undefined, quote: string) => {
			const unquoted = unquote(quote);
			if (unquoted) {
				const snippet: AttachSnippet = {text: unquoted};
				const trimmedLabel = label?.trim();
				if (trimmedLabel) snippet.label = trimmedLabel;
				if (tab) snippet.terminalTabId = tab;
				snippets.push(snippet);
			}
			return "";
		},
	);
	return {snippets, rest: rest.trim()};
}
