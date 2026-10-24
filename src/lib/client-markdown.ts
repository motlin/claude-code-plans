import type {HighlighterCore} from "@shikijs/core";
import MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import {requestLanguage, themeOrRequest} from "../hooks/use-shiki";
import {type CodeThemePair, DEFAULT_CODE_THEMES} from "./code-themes";
import type {FileRef, FileRefBlock} from "./file-refs";
import {normalizeArtifactUrl} from "./artifact-output";
import {ARTIFACT_ICON_SVG, COPY_ICON_SVG, PR_ICON_SVG} from "./icon-paths";
import {mdFileHref, resolveRelativeMdHref} from "./md-links";
import {afterBreak, afterOpaque, newQuoteState, smartenQuotes} from "./smart-quotes";
import {SHIKI_TOKENIZE_OPTIONS} from "./shiki-tokenize-options";
import {defined} from "./defined";

interface MarkdownRenderOptions {
	typographer?: boolean;
	/**
	 * Route prefix that sibling `.md` files are addressed under, e.g.
	 * `/memory/<project>`. Supplying it turns relative `.md` links and
	 * `[[wiki-style]]` cross references inside the body into in-app links.
	 */
	mdLinkBase?: string;
	/**
	 * Inline code whose text is a key renders as a clickable file ref instead of
	 * a code chip; see {@link FILE_REF_ATTR}.
	 */
	fileRefs?: ReadonlyMap<string, FileRef>;
	/**
	 * Titles from the artifacts index keyed by artifact id; a claude.ai artifact
	 * link whose id is here is labelled with the indexed title.
	 */
	artifactTitles?: ReadonlyMap<string, string>;
	/** Settings ▸ Code appearance themes for fenced code; defaults when omitted. */
	codeThemes?: CodeThemePair;
	/** Curl prose quotes as upstream does for assistant text, leaving code and URLs straight. */
	smartQuotes?: boolean;
	/** Underline zoned clock times ("19:24 UTC") with the reader's local time, as upstream's assistant text does. */
	zonedTimes?: boolean;
}

/**
 * Per-render state; the MarkdownIt instances themselves are cached and shared. A class, so rules can narrow
 * markdown-it's untyped `env` with `instanceof`.
 */
class MarkdownEnv {
	readonly mdLinkBase: string | undefined;
	readonly fileRefs: ReadonlyMap<string, FileRef> | undefined;
	readonly artifactTitles: ReadonlyMap<string, string> | undefined;
	readonly smartQuotes: boolean;
	readonly zonedTimes: boolean;

	constructor(options?: MarkdownRenderOptions) {
		this.mdLinkBase = options?.mdLinkBase;
		this.fileRefs = options?.fileRefs;
		this.artifactTitles = options?.artifactTitles;
		this.smartQuotes = options?.smartQuotes === true;
		this.zonedTimes = options?.zonedTimes === true;
	}
}

function toEnv(options?: MarkdownRenderOptions): MarkdownEnv {
	return new MarkdownEnv(options);
}

/** The render's `MarkdownEnv`, or undefined for an env some other caller passed. */
function envOf(env: unknown): MarkdownEnv | undefined {
	return env instanceof MarkdownEnv ? env : undefined;
}

/** Marks a transcript file ref; its `data-file-*` attributes carry the target. */
export const FILE_REF_ATTR = "data-file-ref";

function fileRefHtml(text: string, ref: FileRef, escape: (value: string) => string): string {
	if (ref.block !== undefined) return blockedFileRefHtml(text, ref.path, ref.block, escape);
	const attrs = [
		`role="button"`,
		`tabindex="0"`,
		`class="prose-link"`,
		`${FILE_REF_ATTR}=""`,
		`data-file-path="${escape(ref.path)}"`,
		...(ref.line === undefined ? [] : [`data-file-line="${ref.line}"`]),
		...(ref.endLine === undefined ? [] : [`data-file-end-line="${ref.endLine}"`]),
	];
	return `<span ${attrs.join(" ")}><span data-inline-code="">${escape(text)}</span></span>`;
}

/** Marks the cds disabled-reason wrapper around a blocked file ref; its `[data-disabled-reason]` child holds the reason. */
export const DISABLED_REASON_WRAPPER_ATTR = "data-disabled-reason-wrapper";

/** Upstream's `ir()` reason copy for each block. */
const FILE_REF_BLOCK_REASONS = {
	outside_roots: "This file is outside this session’s folders, so it can’t be opened here.",
} as const satisfies Record<FileRefBlock, string>;

/** A stable id for a reason element: the same path and block always share one, and they say the same thing. */
function reasonId(path: string, block: FileRefBlock): string {
	let hash = 5381;
	for (const char of `${block}\0${path}`) hash = (Math.imul(hash, 33) ^ (char.codePointAt(0) ?? 0)) >>> 0;
	return `file-ref-reason-${hash.toString(36)}`;
}

/** Upstream's `sr`: the plain code chip in a focusable disabled-reason wrapper, with the reason hidden for `aria-describedby`. */
function blockedFileRefHtml(
	text: string,
	path: string,
	block: FileRefBlock,
	escape: (value: string) => string,
): string {
	const id = reasonId(path, block);
	return (
		`<span tabindex="0" ${DISABLED_REASON_WRAPPER_ATTR}="" aria-describedby="${id}" class="inline rounded-sm focus-visible:outline-hidden focus-visible:shadow-focus">` +
		`<code data-inline-code="" data-file-ref-blocked="">${escape(text)}</code>` +
		`<span id="${id}" hidden data-disabled-reason="">${escape(FILE_REF_BLOCK_REASONS[block])}</span></span>`
	);
}

/** Read the ref a {@link FILE_REF_ATTR} element carries. */
export function fileRefFromElement(element: Element): FileRef | null {
	const path = element.getAttribute("data-file-path");
	if (path === null) return null;
	const ref: FileRef = {path};
	const line = element.getAttribute("data-file-line");
	const endLine = element.getAttribute("data-file-end-line");
	if (line !== null) ref.line = Number(line);
	if (endLine !== null) ref.endLine = Number(endLine);
	return ref;
}

type MarkdownVariant = "default" | "typographer";

const plainInstances: Record<MarkdownVariant, MarkdownIt | null> = {
	default: null,
	typographer: null,
};
/** Highlighted instances keyed by variant and the code theme pair they render with. */
const highlightedInstances = new Map<string, MarkdownIt>();
const boundHighlighters = new Map<string, HighlighterCore>();

function getMarkdownVariant(options?: MarkdownRenderOptions): MarkdownVariant {
	return options?.typographer ? "typographer" : "default";
}

/** Marks the wrapper `<div>` a fenced code block and its copy button share. */
export const CODEBLOCK_CLASS = "markdown-codeblock";
/** Marks the full-height rail the sticky control strip rides in. */
const CODEBLOCK_COPY_RAIL_CLASS = "markdown-code-copy-rail";
/** Marks the sticky control strip holding the copy button. */
const CODEBLOCK_COPY_CLASS = "markdown-code-copy";
/** Marks the copy button itself, so one delegated listener can find it. */
export const CODEBLOCK_COPY_ATTR = "data-copy-code";

const COPY_STRIP = `<div class="${CODEBLOCK_COPY_RAIL_CLASS}"><div class="${CODEBLOCK_COPY_CLASS}"><button type="button" ${CODEBLOCK_COPY_ATTR} aria-label="Copy code" data-tooltip="Copy code">${COPY_ICON_SVG}</button></div></div>`;

/**
 * Memory files cross-reference each other with `[[name]]`, which plain markdown
 * leaves as literal text. Resolve it to the sibling memory when the caller told
 * us where siblings live; otherwise decline so the text renders unchanged.
 */
function wikiLink(state: StateInline, silent: boolean): boolean {
	const base = envOf(state.env)?.mdLinkBase;
	if (base === undefined) return false;

	const start = state.pos;
	if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false;
	if (state.src.charCodeAt(start + 1) !== 0x5b) return false;

	const end = state.src.indexOf("]]", start + 2);
	if (end === -1 || end > state.posMax) return false;

	const label = state.src.slice(start + 2, end);
	if (!label || /[[\]\n]/.test(label)) return false;

	if (!silent) {
		state.push("link_open", "a", 1).attrs = [["href", mdFileHref(base, label)]];
		state.push("text", "", 0).content = label;
		state.push("link_close", "a", -1);
	}
	state.pos = end + 2;
	return true;
}

/** Marks a claude.ai artifact link rendered as upstream's link card. */
const ARTIFACT_LINK_ATTR = "data-artifact-link";

const ARTIFACT_LINK_TOKEN = "artifact_link";

/** The plain text of the inline tokens between a link's open and close. */
function linkText(tokens: readonly Token[]): string {
	return tokens
		.filter((token) => token.type === "text" || token.type === "code_inline")
		.map((token) => token.content)
		.join("");
}

/**
 * Collapse every link whose href `match` accepts, whether written or
 * linkified, into one `type` token carrying the href, from which a renderer rule
 * re-derives what matched, and the link's plain text as `content`, so the rule can draw it whole.
 */
function collapseLinks(
	state: StateCore,
	type: string,
	match: (href: string, token: Token, text: string) => boolean,
): void {
	for (const block of state.tokens) {
		const children = block.children;
		if (block.type !== "inline" || children === null) continue;
		const rewritten: Token[] = [];
		for (let index = 0; index < children.length; index++) {
			const token = defined(children[index], "link token index out of range");
			const href = token.type === "link_open" ? token.attrGet("href") : null;
			const close =
				href === null ? -1 : children.findIndex((child, at) => at > index && child.type === "link_close");
			const text = close === -1 ? "" : linkText(children.slice(index + 1, close));
			if (href === null || close === -1 || !match(href, token, text)) {
				rewritten.push(token);
				continue;
			}
			const collapsed = new state.Token(type, "a", 0);
			collapsed.attrs = [["href", href]];
			collapsed.content = text;
			rewritten.push(collapsed);
			index = close;
		}
		block.children = rewritten;
	}
}

/** Upstream renders a markdown link to a claude.ai artifact as an inline chip rather than plain link text. */
function artifactLinks(state: StateCore): void {
	collapseLinks(state, ARTIFACT_LINK_TOKEN, (href) => normalizeArtifactUrl(href) !== undefined);
}

const PR_CHIP_TOKEN = "pr_chip";

const GITHUB_PR_URL = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)\/?(?:[?#].*)?$/;

interface PullRequestRef {
	owner: string;
	repo: string;
	number: string;
}

function parsePullRequestUrl(href: string): PullRequestRef | undefined {
	const match = GITHUB_PR_URL.exec(href);
	if (match === null) return undefined;
	return {
		owner: defined(match[1], "PR URL owner group"),
		repo: defined(match[2], "PR URL repo group"),
		number: defined(match[3], "PR URL number group"),
	};
}

const PR_REF_LABEL = /^(?:([\w.-]+)\/([\w.-]+))?#(\d{1,9})$/;

/**
 * Whether an authored link's text only restates the PR it links, which
 * upstream draws as a chip: no text, the URL itself, or `#n` / `owner/repo#n`
 * naming the same pull request.
 */
function labelNamesPullRequest(text: string, href: string, ref: PullRequestRef): boolean {
	const label = text.trim();
	if (label === "" || label === href) return true;
	const match = PR_REF_LABEL.exec(label);
	if (match === null || match[3] !== ref.number) return false;
	return match[1] === undefined || (match[1] === ref.owner && match[2] === ref.repo);
}

/** Raw PR URLs, and links whose text only restates the PR, become chips; other authored links keep their label tokens. */
function pullRequestChips(state: StateCore): void {
	collapseLinks(state, PR_CHIP_TOKEN, (href, token, text) => {
		const ref = parsePullRequestUrl(href);
		if (ref === undefined) return false;
		return token.markup === "linkify" || token.markup === "autolink" || labelNamesPullRequest(text, href, ref);
	});
}

function pullRequestChipHtml(token: Token, escape: (value: string) => string): string {
	const href = token.attrGet("href") ?? "";
	const {owner, repo, number} = defined(parsePullRequestUrl(href), "PR chip token href");
	return `<a href="${escape(href)}" target="_blank" rel="noreferrer" class="pr-chip"><span class="whitespace-nowrap">${PR_ICON_SVG}${escape(`${owner}/${repo}#${number}`)}</span></a>`;
}

/** Whether `href` leaves the app, so it opens in a new tab like upstream's links. */
function isExternalHref(href: string): boolean {
	return /^https?:\/\//i.test(href);
}

/** Upstream's inline artifact chip: the artifact glyph and title on an accent-muted fill, in the line of prose. */
function artifactLinkHtml(token: Token, env: MarkdownEnv | undefined, escape: (value: string) => string) {
	const href = token.attrGet("href") ?? "";
	const {id} = defined(normalizeArtifactUrl(href), "artifact link token href");
	const title = env?.artifactTitles?.get(id) ?? token.content;
	return `<a href="${escape(href)}" target="_blank" rel="noreferrer" class="artifact-link-chip" ${ARTIFACT_LINK_ATTR}="">${ARTIFACT_ICON_SVG}<span class="artifact-link-chip-title">${escape(title)}</span></a>`;
}

function artifactLinkCardHtml(href: string, host: string, title: string, escape: (value: string) => string): string {
	const label = escape(`Artifact: ${title}`);
	const attrs = [
		`href="${escape(href)}"`,
		`target="_blank"`,
		`rel="noopener noreferrer"`,
		`class="artifact-link-card"`,
		`${ARTIFACT_LINK_ATTR}=""`,
		`aria-label="${label}"`,
		`title="${label}"`,
	];
	return `<a ${attrs.join(" ")}><span class="artifact-link-card-title">${escape(title)}</span><span class="artifact-link-card-meta">Artifact · ${escape(host)}</span></a>`;
}

/** Upstream's artifact link card for `href`, as an Artifact tool result renders. */
export function renderArtifactLinkCard(href: string, title: string): string {
	let host = "";
	try {
		host = new URL(href).host;
	} catch {
		// An unparsable href still renders, captioned without a host.
	}
	return artifactLinkCardHtml(href, host, title, getPlainMarkdownIt().utils.escapeHtml);
}

const NUMERIC_CELL = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?%?$/;

function isNumericCell(text: string): boolean {
	const trimmed = text.trim();
	return /\d/.test(trimmed) && NUMERIC_CELL.test(trimmed);
}

/** Groups one table's cell-open tokens by column, with each body cell's text. */
function tableColumns(tokens: Token[], start: number): {end: number; columns: {cells: Token[]; body: string[]}[]} {
	const columns: {cells: Token[]; body: string[]}[] = [];
	let column = 0;
	let index = start + 1;
	for (; index < tokens.length; index++) {
		const token = defined(tokens[index], "table token index out of range");
		if (token.type === "table_close") break;
		if (token.type === "tr_open") column = 0;
		if (token.type !== "th_open" && token.type !== "td_open") continue;
		const entry = (columns[column] ??= {cells: [], body: []});
		entry.cells.push(token);
		if (token.type === "td_open") entry.body.push(tokens[index + 1]?.content ?? "");
		column++;
	}
	return {end: index, columns};
}

/** Marks every cell of a column whose body cells all parse as numbers, so it can right-align like upstream's. */
function numericTableColumns(state: StateCore): void {
	for (let index = 0; index < state.tokens.length; index++) {
		if (state.tokens[index]?.type !== "table_open") continue;
		const {end, columns} = tableColumns(state.tokens, index);
		for (const {cells, body} of columns) {
			if (body.length === 0 || !body.every(isNumericCell)) continue;
			for (const cell of cells) cell.attrSet("data-numeric", "");
		}
		index = end;
	}
}

/** Whether a link shows its own URL, which upstream leaves as written. */
function isBareUrlLink(children: readonly Token[], open: number): boolean {
	const text = children[open + 1];
	if (text?.type !== "text" || children[open + 2]?.type !== "link_close") return false;
	const href = children[open]?.attrGet("href");
	return href === text.content || href === `http://${text.content}` || href === `mailto:${text.content}`;
}

/**
 * Curl the quotes of each paragraph, heading and table cell when the render
 * asks for it, carrying context across its text runs. Code, bare URLs and other
 * opaque inline content stay straight and read as a word to what follows.
 */
function smartQuotes(state: StateCore): void {
	if (envOf(state.env)?.smartQuotes !== true) return;
	for (const block of state.tokens) {
		const children = block.type === "inline" ? block.children : null;
		if (children === null) continue;
		const quotes = newQuoteState();
		for (let i = 0; i < children.length; i++) {
			const token = defined(children[i], "inline token index out of range");
			switch (token.type) {
				case "text":
					token.content = smartenQuotes(token.content, quotes);
					break;
				case "softbreak":
				case "hardbreak":
					afterBreak(quotes);
					break;
				case "link_open":
					if (isBareUrlLink(children, i)) {
						afterOpaque(quotes);
						i += 2;
					}
					break;
				case "link_close":
				case "strong_open":
				case "strong_close":
				case "em_open":
				case "em_close":
				case "s_open":
				case "s_close":
					break;
				default:
					afterOpaque(quotes);
			}
		}
	}
}

const ZONED_TIME_TOKEN = "time_with_zone";

/**
 * The zone tables and parser load only once some prose holds a clock time, so
 * they stay off the session's cold load; subscribers re-render when they land.
 */
let timeWithZone: typeof import("./time-with-zone") | null = null;
let timeWithZoneLoad: Promise<void> | null = null;
let zonedTimesLoadVersion = 0;
const zonedTimesListeners = new Set<() => void>();

/** Cheap test for text that might hold a zoned clock time. */
const CLOCK_TIME_CANDIDATE = /\d:\d\d/;

async function loadTimeWithZone(): Promise<void> {
	timeWithZoneLoad ??= import("./time-with-zone").then((module) => {
		timeWithZone = module;
		zonedTimesLoadVersion++;
		for (const listener of zonedTimesListeners) listener();
	});
	return timeWithZoneLoad;
}

/** Subscribe function for useSyncExternalStore: fires once the zoned-time parser loads. */
export function subscribeZonedTimes(listener: () => void): () => void {
	zonedTimesListeners.add(listener);
	return () => {
		zonedTimesListeners.delete(listener);
	};
}

/** Snapshot for useSyncExternalStore that changes only for markdown the parser's arrival can redraw. */
export function zonedTimesVersion(markdown: string, enabled: boolean): number {
	return enabled && CLOCK_TIME_CANDIDATE.test(markdown) ? zonedTimesLoadVersion : 0;
}

/** Split each zoned clock time into its own token, once the parser has loaded and when the render asks for it. */
function zonedTimes(state: StateCore): void {
	if (envOf(state.env)?.zonedTimes !== true) return;
	if (timeWithZone === null) {
		if (CLOCK_TIME_CANDIDATE.test(state.src)) void loadTimeWithZone();
		return;
	}
	timeWithZone.splitZonedTimes(state, ZONED_TIME_TOKEN);
}

/** The plugins and renderer overrides every cached instance shares. */
function applyPlugins(instance: MarkdownIt): void {
	instance.use(taskLists);
	instance.use(footnote);
	instance.inline.ruler.before("link", "wikilink", wikiLink);
	instance.core.ruler.push(ARTIFACT_LINK_TOKEN, artifactLinks);
	instance.renderer.rules[ARTIFACT_LINK_TOKEN] = (tokens, idx, _options, env) =>
		artifactLinkHtml(defined(tokens[idx], "artifact link token"), envOf(env), instance.utils.escapeHtml);
	instance.core.ruler.push(PR_CHIP_TOKEN, pullRequestChips);
	instance.core.ruler.push("numeric_table_columns", numericTableColumns);
	instance.core.ruler.push("smart_quotes", smartQuotes);
	instance.core.ruler.push(ZONED_TIME_TOKEN, zonedTimes);
	instance.renderer.rules[ZONED_TIME_TOKEN] = (tokens, idx) =>
		defined(timeWithZone, "zoned time token before its parser loaded").zonedTimeHtml(
			defined(tokens[idx], "zoned time token index").content,
			instance.utils.escapeHtml,
		);
	instance.renderer.rules[PR_CHIP_TOKEN] = (tokens, idx) =>
		pullRequestChipHtml(defined(tokens[idx], "PR chip token"), instance.utils.escapeHtml);

	// Links written inside a memory file keep their `.md` extension, but the
	// route that serves them is keyed by the extension-less slug, so an
	// unrewritten link is a hard 404 rather than a redirect.
	const renderCodeInline = defined(instance.renderer.rules.code_inline, "markdown-it code_inline rule");
	instance.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
		const text = defined(tokens[idx], "code_inline token").content;
		const ref = envOf(env)?.fileRefs?.get(text);
		return ref === undefined
			? renderCodeInline(tokens, idx, options, env, self)
			: fileRefHtml(text, ref, instance.utils.escapeHtml);
	};

	instance.renderer.rules["link_open"] = (tokens, idx, options, env, self) => {
		const token = defined(tokens[idx], "link_open token");
		const href = token.attrGet("href");
		const base = envOf(env)?.mdLinkBase;
		if (base !== undefined) {
			const resolved = href === null ? null : resolveRelativeMdHref(href, base);
			if (resolved !== null) token.attrSet("href", resolved);
		}
		if (href !== null && isExternalHref(href)) {
			token.attrSet("target", "_blank");
			token.attrSet("rel", "noreferrer");
		}
		return self.renderToken(tokens, idx, options);
	};

	// Upstream wraps every fence in a relative box carrying an absolutely
	// positioned top-right control strip with an icon-only copy button; a bare
	// markdown-it `<pre>` has nowhere to anchor one.
	const renderFence = defined(instance.renderer.rules.fence, "markdown-it fence rule");
	instance.renderer.rules.fence = (tokens, idx, options, env, self) =>
		`<div class="${CODEBLOCK_CLASS}">${renderFence(tokens, idx, options, env, self).trimEnd()}${COPY_STRIP}</div>\n`;

	// Upstream renders every table inside an `overflow-x-auto` div so a table wider
	// than the transcript column scrolls on its own instead of stretching the column.
	instance.renderer.rules["table_open"] = (tokens, idx, options, _env, self) =>
		`<div class="markdown-table-wrapper">${self.renderToken(tokens, idx, options)}`;
	instance.renderer.rules["table_close"] = (tokens, idx, options, _env, self) =>
		`${self.renderToken(tokens, idx, options)}</div>`;
}

function getPlainMarkdownIt(options?: MarkdownRenderOptions): MarkdownIt {
	const variant = getMarkdownVariant(options);
	const cachedInstance = plainInstances[variant];
	if (cachedInstance) return cachedInstance;

	const instance = MarkdownIt({
		html: false,
		linkify: true,
		typographer: options?.typographer ?? false,
	});
	applyPlugins(instance);
	plainInstances[variant] = instance;
	return instance;
}

function getHighlightedMarkdownIt(highlighter: HighlighterCore, options?: MarkdownRenderOptions): MarkdownIt {
	const variant = getMarkdownVariant(options);
	const chosen = options?.codeThemes ?? DEFAULT_CODE_THEMES;
	const themes = {
		light:
			chosen.light === DEFAULT_CODE_THEMES.light
				? chosen.light
				: themeOrRequest(highlighter, chosen.light, DEFAULT_CODE_THEMES.light),
		dark:
			chosen.dark === DEFAULT_CODE_THEMES.dark
				? chosen.dark
				: themeOrRequest(highlighter, chosen.dark, DEFAULT_CODE_THEMES.dark),
	};
	const cacheKey = `${variant}:${themes.light}:${themes.dark}`;

	// Re-use the cached instance if the highlighter hasn't changed.
	const cachedInstance = highlightedInstances.get(cacheKey);
	if (cachedInstance && boundHighlighters.get(cacheKey) === highlighter) return cachedInstance;

	const instance = MarkdownIt({
		html: false,
		linkify: true,
		typographer: options?.typographer ?? false,
		highlight(code: string, lang: string): string {
			const language = lang || "text";
			if (language === "text") return "";
			if (!highlighter.getLoadedLanguages().includes(language)) {
				void requestLanguage(language);
				return "";
			}
			try {
				let trimmed = code;
				if (trimmed.endsWith("\n")) trimmed = trimmed.slice(0, -1);
				return highlighter.codeToHtml(trimmed, {
					...SHIKI_TOKENIZE_OPTIONS,
					lang: language,
					themes,
					defaultColor: "light",
					cssVariablePrefix: "--shiki-",
				});
			} catch {
				return "";
			}
		},
	});
	applyPlugins(instance);
	highlightedInstances.set(cacheKey, instance);
	boundHighlighters.set(cacheKey, highlighter);
	return instance;
}

/** Render markdown to HTML without syntax highlighting. */
export function renderMarkdownToHtml(markdown: string, options?: MarkdownRenderOptions): string {
	if (!markdown.trim()) return "";
	return getPlainMarkdownIt(options).render(markdown, toEnv(options));
}

/** Render markdown to inline HTML without a paragraph wrapper. */
export function renderInlineMarkdownToHtml(markdown: string, options?: MarkdownRenderOptions): string {
	if (!markdown.trim()) return "";
	return getPlainMarkdownIt(options).renderInline(markdown, toEnv(options));
}

const ARTIFACT_URL_HINT = /claude\.ai\/(?:code\/)?artifact\//;

/** Whether `markdown` may hold a claude.ai artifact link worth resolving titles for. */
export function mentionsArtifactUrl(markdown: string): boolean {
	return ARTIFACT_URL_HINT.test(markdown);
}

/** The text of every inline code span in `markdown`, in document order. */
export function inlineCodeTexts(markdown: string): string[] {
	const texts: string[] = [];
	for (const token of getPlainMarkdownIt().parse(markdown, {})) {
		for (const child of token.children ?? []) {
			if (child.type === "code_inline") texts.push(child.content);
		}
	}
	return texts;
}

/**
 * Render markdown to HTML with Shiki syntax highlighting for code blocks.
 * When `highlighter` is null (not yet loaded), falls back to unstyled code.
 */
export function renderMarkdownWithHighlighting(
	markdown: string,
	highlighter: HighlighterCore | null,
	options?: MarkdownRenderOptions,
): string {
	if (!markdown.trim()) return "";
	if (!highlighter) return renderMarkdownToHtml(markdown, options);
	return getHighlightedMarkdownIt(highlighter, options).render(markdown, toEnv(options));
}

export function looksLikeMarkdown(text: string): boolean {
	let indicators = 0;
	if (/^#{1,6}\s/m.test(text)) indicators++;
	if (text.includes("```")) indicators++;
	if (/^\s*[-*]\s/m.test(text)) indicators++;
	if (/\*\*[^*]+\*\*/.test(text)) indicators++;
	if (/\[[^\]]+\]\([^)]+\)/.test(text)) indicators++;
	return indicators >= 2;
}
