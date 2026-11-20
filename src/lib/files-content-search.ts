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
	matches: TextRange[];
}

/**
 * Upstream `nD`'s snippet: the lead before the first hit (cut behind "…" on a long line), the hit with
 * the whitespace before it, and the tail; match ranges are relative to the hit and the tail.
 */
export interface SnippetParts
{
	lead: string;
	hit: string;
	hitMatches: TextRange[];
	tail: string;
	tailMatches: TextRange[];
}

export interface ContentSearchMatch
{
	line: number;
	/** The whole line, whitespace collapsed and trimmed. */
	text: string;
	snippet: SnippetParts;
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

/** Upstream's `ZE`: lead context before the hit in a snippet. */
const SNIPPET_LEAD = 26;
/** Upstream's `QE`: a forward cut stops this many characters short of the hit. */
const SNIPPET_MIN_LEAD = 10;
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

/** Turns the search API's escaped `<mark>` snippet into plain text and its highlighted ranges. */
export function parseMarkedSnippet(html: string): MarkedText
{
	let text = "";
	const matches: TextRange[] = [];
	for (const [index, part] of html.split(/<\/?mark>/).entries())
	{
		const plain = unescapeHtml(part);
		if (index % 2 === 1 && plain !== "")
			matches.push(
				{
					start: text.length,
					end: text.length + plain.length,
				},
			);
		text += plain;
	}
	return {
		text,
		matches,
	};
}

function collapse(value: string): string
{
	return value.replace(/\s+/g, " ");
}

/** Upstream `XE`: ranges shifted onto the trimmed text, clamped, empty ones dropped. */
function trimRanges(text: string, ranges: readonly TextRange[]): TextRange[]
{
	const leading = text.length - text.trimStart().length;
	const length = text.trim().length;
	return ranges
		.map(({start, end}) => (
		{
			start: Math.max(0, start - leading),
			end: Math.min(length, end - leading),
		}))
		.filter((range) => range.end > range.start);
}

/** Upstream `$E`: whitespace runs collapsed to one space, ranges mapped onto the result. */
function collapseRanges(text: string, ranges: readonly TextRange[]): MarkedText
{
	let collapsed = "";
	const offsets: number[] = [];
	let inSpace = false;
	for (const char of text.split(""))
	{
		offsets.push(collapsed.length);
		const space = /\s/.test(char);
		if (!space) collapsed += char;
		else if (!inSpace) collapsed += " ";
		inSpace = space;
	}
	offsets.push(collapsed.length);
	return {
		text: collapsed,
		matches: ranges
			.map(({start, end}) => (
			{
				start: offsets[start] ?? 0,
				end: offsets[end] ?? 0,
			}))
			.filter((range) => range.end > range.start),
	};
}

/** Upstream `eD`: `[0-9A-Za-z_]`. */
function isWordCode(code: number): boolean
{
	return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/** Upstream `tD`: a word character meets a non-word one at `index`. */
function isWordBoundary(text: string, index: number): boolean
{
	return isWordCode(text.charCodeAt(index - 1)) !== isWordCode(text.charCodeAt(index));
}

const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

/** Upstream `nD`: splits a collapsed line around its first hit, cutting a lead longer than 26 characters. */
function splitSnippet(text: string, matches: readonly TextRange[]): SnippetParts
{
	const [first, ...rest] = matches;
	if (first === undefined)
		return {
			lead: "",
			hit: "",
			hitMatches: [],
			tail: text,
			tailMatches: [],
		};
	const parts = (cut: number, prefix: string): SnippetParts =>
	{
		let hitStart = first.start;
		while (hitStart > cut && /\s/.test(text.charAt(hitStart - 1))) hitStart -= 1;
		return {
			lead: `${prefix}${text.slice(cut, hitStart)}`,
			hit: text.slice(hitStart, first.end),
			hitMatches: [
				{
					start: first.start - hitStart,
					end: first.end - hitStart,
				},
			],
			tail: text.slice(first.end),
			tailMatches: rest.map(({start, end}) => (
			{
				start: start - first.end,
				end: end - first.end,
			})),
		};
	};
	if (first.start <= SNIPPET_LEAD) return parts(0, "");
	const anchor = first.start - SNIPPET_LEAD;
	let backward: number | undefined;
	for (let index = anchor; index > anchor - SNIPPET_LEAD && index > 0; index -= 1)
	{
		if (isWordBoundary(text, index))
		{
			backward = index;
			break;
		}
	}
	let forward: number | undefined;
	for (let index = anchor + 1; index <= first.start - SNIPPET_MIN_LEAD; index += 1)
	{
		if (isWordBoundary(text, index))
		{
			forward = index;
			break;
		}
	}
	let cut =
		forward !== undefined && (backward === undefined || forward - anchor <= anchor - backward)
			? forward
			: (backward ?? anchor);
	while (cut < first.start && /\s/.test(text.charAt(cut))) cut += 1;
	const code = text.charCodeAt(cut);
	if (code >= LOW_SURROGATE_FIRST && code <= LOW_SURROGATE_LAST) cut += 1;
	return parts(cut, ELLIPSIS);
}

/**
 * Upstream's match-row snippet (`XE` → `$E` → `nD`): the line trimmed and its whitespace collapsed,
 * then split into lead, hit and tail, the lead cut to a word boundary behind "…" when long.
 */
export function windowSnippet(text: string, matches: readonly TextRange[]): SnippetParts
{
	const collapsed = collapseRanges(text.trim(), trimRanges(text, matches));
	return splitSnippet(collapsed.text, collapsed.matches);
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
				snippet: windowSnippet(marked.text, marked.matches),
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
