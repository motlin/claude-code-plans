import type {FileSearchResult} from "./api/search";

/**
 * claude.ai/code's "?" content search in the Files filter: a filter starting
 * with "?" searches file contents instead of paths, and each hit shows a
 * windowed snippet of its line grouped under its file.
 */

/** A half-open `[start, end)` range of UTF-16 code units. */
export interface TextRange {
	start: number;
	end: number;
}

export interface MarkedText {
	text: string;
	match: TextRange | null;
}

export interface ContentSearchMatch {
	line: number;
	/** The whole line, whitespace collapsed and trimmed. */
	text: string;
	snippet: MarkedText;
}

export interface ContentSearchGroup {
	/** Absolute path of the file. */
	path: string;
	/** The path relative to the working directory, or absolute outside it. */
	relPath: string;
	matches: ContentSearchMatch[];
	/** The file has matches beyond those shown. */
	more: boolean;
}

export interface ContentSearchResults {
	groups: ContentSearchGroup[];
	shownCount: number;
	/** Some files were left out, so the list should ask for a narrower query. */
	capped: boolean;
}

/** Upstream's lead context before the match in a snippet. */
const SNIPPET_LEAD = 26;
const MATCHES_PER_FILE = 5;
const ELLIPSIS = "…";

/** The content query of a "?" filter, or null when the filter searches paths. */
export function parseContentSearchQuery(filter: string): string | null {
	return filter.startsWith("?") ? filter.slice(1).trim() : null;
}

const HTML_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
};

function unescapeHtml(value: string): string {
	return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

/** Turns the search API's escaped `<mark>` snippet into plain text and its first highlighted range. */
export function parseMarkedSnippet(html: string): MarkedText {
	let text = "";
	let match: TextRange | null = null;
	for (const [index, part] of html.split(/<\/?mark>/).entries()) {
		const plain = unescapeHtml(part);
		if (index % 2 === 1 && match === null) match = {start: text.length, end: text.length + plain.length};
		text += plain;
	}
	return {text, match};
}

function collapse(value: string): string {
	return value.replace(/\s+/g, " ");
}

/**
 * Upstream's snippet window: whitespace collapsed, at most 26 characters of
 * lead before the match, the cut snapped forward to the next word start, and
 * a leading "…" when anything was cut.
 */
export function windowSnippet(text: string, match: TextRange | null): MarkedText {
	if (match === null) return {text: collapse(text).trim(), match: null};
	const before = collapse(text.slice(0, match.start)).trimStart();
	const matched = collapse(text.slice(match.start, match.end));
	const after = collapse(text.slice(match.end)).trimEnd();
	if (before.length <= SNIPPET_LEAD) {
		return {
			text: `${before}${matched}${after}`,
			match: {start: before.length, end: before.length + matched.length},
		};
	}
	let cut = before.length - SNIPPET_LEAD;
	if (before[cut - 1] !== " ") {
		const nextSpace = before.indexOf(" ", cut);
		if (nextSpace !== -1) cut = nextSpace + 1;
	}
	const lead = `${ELLIPSIS}${before.slice(cut)}`;
	return {
		text: `${lead}${matched}${after}`,
		match: {start: lead.length, end: lead.length + matched.length},
	};
}

/** Smart case: an all-lower-case query ignores case, otherwise every word must match exactly. */
export function matchesSmartCase(text: string, query: string): boolean {
	if (query === query.toLowerCase()) return true;
	return query
		.split(/\s+/)
		.filter((word) => word !== "")
		.every((word) => text.includes(word));
}

function relativePath(path: string, cwd: string): string {
	const prefix = `${cwd.replace(/\/+$/, "")}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** The search response as per-file groups of windowed matches, dropping files that matched only by path. */
export function groupContentSearchResults(result: FileSearchResult, cwd: string, query: string): ContentSearchResults {
	const groups: ContentSearchGroup[] = [];
	for (const file of result.files) {
		const matches = file.matches.flatMap((match) => {
			const marked = parseMarkedSnippet(match.snippet);
			if (!matchesSmartCase(marked.text, query)) return [];
			return [
				{
					line: match.lineNumber,
					text: collapse(marked.text).trim(),
					snippet: windowSnippet(marked.text, marked.match),
				},
			];
		});
		if (matches.length === 0) continue;
		groups.push({
			path: file.path,
			relPath: relativePath(file.path, cwd),
			matches: matches.slice(0, MATCHES_PER_FILE),
			more: matches.length > MATCHES_PER_FILE || file.matchCount > file.matches.length,
		});
	}
	return {
		groups,
		shownCount: groups.reduce((total, group) => total + group.matches.length, 0),
		capped: result.isTruncated && result.files.length < result.totalFiles,
	};
}

/** Upstream's "Ask about this" prompt, put into the chat input without sending it. */
export function askAboutPrompt(path: string, line: number, snippet: string): string {
	return `In ${path} at line ${line}: \`${snippet}\` — explain what this does and where it’s used.`;
}
