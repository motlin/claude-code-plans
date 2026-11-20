import type {FileSearchResult} from "./api/search";

/**
 * claude.ai/code's "?" content search in the Files filter: a filter starting
 * with "?" searches file contents instead of paths, and each hit shows a
 * windowed snippet of its line grouped under its file.
 */

/** A half-open `[start, end)` range of UTF-16 code units. */
export interface TextRange
{
	start: number;
	end: number;
}

export interface MarkedText
{
	text: string;
	match: TextRange | null;
}

export interface ContentSearchMatch
{
	line: number;
	/** The whole line, whitespace collapsed and trimmed. */
	text: string;
	snippet: MarkedText;
}

export interface ContentSearchGroup
{
	/** Absolute path of the file. */
	path: string;
	/** The path relative to the working directory, or absolute outside it. */
	relPath: string;
	matches: ContentSearchMatch[];
	/** The file has matches beyond those shown. */
	more: boolean;
	/** The widest line number listed, which sizes the line-number column. */
	maxLine: number;
}

export interface ContentSearchResults
{
	groups: ContentSearchGroup[];
	shown: number;
	/** Matches were left out at the cap, so the list should ask for a narrower query. */
	truncated: boolean;
	/** The search didn't cover everything, so matches may be missing. */
	unfinished: boolean;
	failed: boolean;
}

/** Upstream's `kD` outcome of a settled search; undefined when the results need no message. */
export type ContentSearchOutcome = "failed" | "unfinished" | "someMissing" | "none";

export const CONTENT_SEARCH_MESSAGES: Record<ContentSearchOutcome, string> =
{
	none: "No matches in file contents",
	failed: "Couldn’t search in files.",
	unfinished: "The search didn’t finish. No matches so far.",
	someMissing: "The search didn’t finish, so some matches may be missing.",
};

export const EMPTY_CONTENT_SEARCH_RESULTS: ContentSearchResults =
{
	groups: [],
	shown: 0,
	truncated: false,
	unfinished: false,
	failed: false,
};

/** Upstream's lead context before the match in a snippet. */
const SNIPPET_LEAD = 26;
const MATCHES_PER_FILE = 5;
/** Upstream's `JE` limits: the host asks for 241 matches and the list shows at most 200. */
const RAW_MATCH_LIMIT = 241;
const SHOWN_MATCH_LIMIT = 200;
const ELLIPSIS = "…";

/** The content query of a "?" filter, or null when the filter searches paths. */
export function parseContentSearchQuery(filter: string): string | null
{
	return filter.startsWith("?") ? filter.slice(1).trim() : null;
}

const HTML_ENTITIES: Record<string, string> =
{
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
};

function unescapeHtml(value: string): string
{
	return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

/** Turns the search API's escaped `<mark>` snippet into plain text and its first highlighted range. */
export function parseMarkedSnippet(html: string): MarkedText
{
	let text = "";
	let match: TextRange | null = null;
	for (const [index, part] of html.split(/<\/?mark>/).entries())
	{
		const plain = unescapeHtml(part);
		if (index % 2 === 1 && match === null)
			match =
			{
				start: text.length,
				end: text.length + plain.length,
			};
		text += plain;
	}
	return {
		text,
		match,
	};
}

function collapse(value: string): string
{
	return value.replace(/\s+/g, " ");
}

/**
 * Upstream's snippet window: whitespace collapsed, at most 26 characters of
 * lead before the match, the cut snapped forward to the next word start, and
 * a leading "…" when anything was cut.
 */
export function windowSnippet(text: string, match: TextRange | null): MarkedText
{
	if (match === null)
		return {
			text: collapse(text).trim(),
			match: null,
		};
	const before = collapse(text.slice(0, match.start)).trimStart();
	const matched = collapse(text.slice(match.start, match.end));
	const after = collapse(text.slice(match.end)).trimEnd();
	if (before.length <= SNIPPET_LEAD)
	{
		return {
			text: `${before}${matched}${after}`,
			match:
			{
				start: before.length,
				end: before.length + matched.length,
			},
		};
	}
	let cut = before.length - SNIPPET_LEAD;
	if (before[cut - 1] !== " ")
	{
		const nextSpace = before.indexOf(" ", cut);
		if (nextSpace !== -1) cut = nextSpace + 1;
	}
	const lead = `${ELLIPSIS}${before.slice(cut)}`;
	return {
		text: `${lead}${matched}${after}`,
		match:
		{
			start: lead.length,
			end: lead.length + matched.length,
		},
	};
}

/** Smart case: an all-lower-case query ignores case, otherwise every word must match exactly. */
export function matchesSmartCase(text: string, query: string): boolean
{
	if (query === query.toLowerCase()) return true;
	return query
		.split(/\s+/)
		.filter((word) => word !== "")
		.every((word) => text.includes(word));
}

function relativePath(path: string, cwd: string): string
{
	const prefix = `${cwd.replace(/\/+$/, "")}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * The search response as per-file groups of windowed matches, dropping files that matched only by path.
 * Upstream's `JE`: walking the matches in order, a file lists at most 5 (`more` beyond that) and the
 * list at most 200; past that cap no new file starts and a file that loses a match gets `more`.
 * It is truncated at 241 raw matches, when a match is dropped at the cap, or when the server left files out.
 */
export function groupContentSearchResults(result: FileSearchResult, cwd: string, query: string): ContentSearchResults
{
	const groups: ContentSearchGroup[] = [];
	let shown = 0;
	let rawCount = 0;
	let truncated = result.files.length < result.totalFiles;
	for (const file of result.files)
	{
		let group: ContentSearchGroup | undefined;
		rawCount += Math.max(0, file.matchCount - file.matches.length);
		for (const match of file.matches)
		{
			const marked = parseMarkedSnippet(match.snippet);
			if (!matchesSmartCase(marked.text, query)) continue;
			rawCount += 1;
			if (group !== undefined && group.matches.length >= MATCHES_PER_FILE)
			{
				group.more = true;
				continue;
			}
			if (shown >= SHOWN_MATCH_LIMIT)
			{
				truncated = true;
				if (group !== undefined) group.more = true;
				continue;
			}
			const listed =
			{
				line: match.lineNumber,
				text: collapse(marked.text).trim(),
				snippet: windowSnippet(marked.text, marked.match),
			};
			shown += 1;
			if (group === undefined)
			{
				group =
				{
					path: file.path,
					relPath: relativePath(file.path, cwd),
					matches: [listed],
					more: false,
					maxLine: listed.line,
				};
				groups.push(group);
			}
			else
			{
				group.matches.push(listed);
				group.maxLine = Math.max(group.maxLine, listed.line);
			}
		}
		if (group !== undefined && file.matchCount > file.matches.length) group.more = true;
	}
	return {
		groups,
		shown,
		truncated: truncated || rawCount >= RAW_MATCH_LIMIT,
		unfinished: result.unfinished,
		failed: false,
	};
}

/** Upstream's `kD`: which message a settled search shows, if any. */
export function contentSearchOutcome({
	groupCount,
	failed,
	unfinished,
}: {
	groupCount: number;
	failed: boolean;
	unfinished: boolean;
}): ContentSearchOutcome | undefined
{
	if (failed) return "failed";
	if (groupCount > 0) return unfinished ? "someMissing" : undefined;
	return unfinished ? "unfinished" : "none";
}

/** Upstream's `LD` note under the matches: the cap text, then the someMissing text, joined by a space. */
export function contentSearchCapNote({
	shown,
	truncated,
	unfinished,
}: {
	shown: number;
	truncated: boolean;
	unfinished: boolean;
}): string | null
{
	const parts: string[] = [];
	if (truncated)
		parts.push(`Only ${shown} ${shown === 1 ? "match is" : "matches are"} shown. Keep typing to narrow.`);
	if (unfinished) parts.push(CONTENT_SEARCH_MESSAGES.someMissing);
	return parts.length === 0 ? null : parts.join(" ");
}

/**
 * Upstream's `jD` structural sharing: a refetch that failed or stopped early with no matches keeps
 * the matches already shown, flagged unfinished, so the someMissing note and Try again appear.
 */
export function keepResultsOnFailedRefetch(
	previous: ContentSearchResults | undefined,
	next: ContentSearchResults,
): ContentSearchResults
{
	const keep =
		previous !== undefined &&
		previous.groups.length > 0 &&
		next.groups.length === 0 &&
		(next.failed || next.unfinished);
	return keep
		?
			{
				...previous,
				unfinished: true,
			}
		: next;
}

/** Upstream's "Ask about this" prompt, put into the chat input without sending it. */
export function askAboutPrompt(path: string, line: number, snippet: string): string
{
	return `In ${path} at line ${line}: \`${snippet}\` — explain what this does and where it’s used.`;
}
