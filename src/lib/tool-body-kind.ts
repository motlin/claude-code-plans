// Port of upstream claude.ai/code's generic tool body kinds (cb6930dae `o_` with `qg`/`Kg` JSON, the `Xg`
// markdown sniff, the `a_` markdown gate and `Qg` columns), dumped in
// .llm/upstream-sync/dumps/tool-output-body-kinds-bundle-2026-11-06.js.txt.

import {maskSecrets} from "./secret-mask";
import {JSON_TILE_MAX_LINES, MAX_CHARS, prettyJson} from "./pretty-json";
import {stripMemoryTags} from "./task-checklist";

export type ToolBodyKind =
	|
	  {
			kind: "json";
			text: string;
			tile: boolean;
	  }
	|
	  {
			kind: "markdown";
			text: string;
	  }
	|
	  {
			kind: "text";
			text: string;
			columns: boolean;
	  };

/** Jg */
const MARKDOWN_SIGNS = [
	/^\|?(?: *:?-{3,}:? *\|)+ *(?::?-{3,}:? *\|?)?$/m,
	/(?<![\w*/])\*\*[^\s*/](?:[^*\n]*[^\s*/])?\*\*(?![\w*/])/,
	/\[[^\]\n]{1,500}\]\(https?:\/\/[^\s)]{1,2048}\)/,
];

/** Yg: an opening fence line with a closing fence somewhere after it. */
function hasClosedFence(text: string): boolean
{
	const open = /^```[^\n]*\n/m.exec(text);
	return open !== null && /^``` *$/m.test(text.slice(open.index + open[0].length));
}

/** Xg: whether the text reads as markdown (a table, bold, an http link, a fence, or an h2+ heading with a bullet). */
export function sniffMarkdown(text: string): boolean
{
	return (
		MARKDOWN_SIGNS.some((sign) => sign.test(text)) ||
		hasClosedFence(text) ||
		(/^#{2,6} \S/m.test(text) && /^[-*] \S/m.test(text))
	);
}

/** Zg */
const COLUMNS_LINE = /^.*(?:\S(?: {2,}|\t)\S|^(?: {2,}|\t)\S).*$/gm;

/** Qg: at least two lines with an interior run of 2+ spaces or a tab, or a leading indent. */
export function isColumns(text: string): boolean
{
	const lines = text.matchAll(COLUMNS_LINE);
	lines.next();
	return lines.next().done === false;
}

/** Qn: an ANSI escape. */
// eslint-disable-next-line no-control-regex -- spotting terminal escapes is the point
const ANSI = /\x1b\[/;
/** K7 + i_, narrowed to the forms local markdown would mangle: display/inline TeX delimiters and math fences. */
const MATH = /\$\$|\\\(|\\\[|(?:```|~~~)\s*math(?!\S)/;

/**
 * a_: markdown worth rendering. Local markdown has no math parser, so text that looks like math is never
 * markdown (upstream renders it only when the parse holds no math node); the secret checks use the local
 * port of upstream's masker on the source text rather than on the rendered text.
 */
function markdownAllowed(text: string): boolean
{
	const stripped = stripMemoryTags(text);
	if (ANSI.test(stripped) || !sniffMarkdown(stripped)) return false;
	return !MATH.test(stripped) && maskSecrets(text) === text;
}

/** qe */
function lineCount(text: string): number
{
	return text.split("\n").length;
}

/** o_: the body's kind. Callers pass `allowMarkdown: !["Grep", "Glob"].includes(name)` (upstream `Hg`). */
export function classifyToolBody(
	text: string,
	{
		allowMarkdown,
	}:
	{
		allowMarkdown: boolean;
	},
): ToolBodyKind
{
	const pretty = prettyJson(text);
	if (pretty !== undefined)
	{
		return {
			kind: "json",
			text: pretty,
			tile: lineCount(pretty) <= JSON_TILE_MAX_LINES && maskSecrets(pretty) === pretty,
		};
	}
	if (allowMarkdown && text.length <= MAX_CHARS && markdownAllowed(text))
		return {
			kind: "markdown",
			text,
		};
	return {
		kind: "text",
		text,
		columns: text.length <= MAX_CHARS && isColumns(text),
	};
}

/** Hg: tools whose output never renders as markdown. */
export function allowsMarkdownBody(toolName: string): boolean
{
	return toolName !== "Grep" && toolName !== "Glob";
}
