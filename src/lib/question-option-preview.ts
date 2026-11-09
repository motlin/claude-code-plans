import {replaceHiddenChars} from "./hidden-chars";

/** A single-select option's `preview`, as upstream's `mU` (shared-33) parses it. */
export type OptionPreview = {kind: "text"; text: string} | {kind: "html"; sanitizedHtml: string};

/** Upstream's `f6`: a tag with one of these names makes a preview HTML. */
const HTML_TAGS: ReadonlySet<string> = new Set(
	"a abbr article aside b blockquote body button canvas caption code col dd details div dl dt em figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hr html i iframe img input label li link main mark meta nav ol option p pre s script section select small span strong style sub summary sup svg table tbody td textarea tfoot th thead tr u ul video".split(
		" ",
	),
);
/** Upstream's `Yy`. */
const TAG_RE = /<\/?([a-z][a-z0-9]*)(?=[\s/>])[^<>]*>/gi;
/** Upstream's `cM`: a fence opening. */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
/** Upstream's `vf`: a fence closing. */
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** Upstream's `P6`. */
function isIndented(line: string): boolean {
	return line.startsWith("    ") || line.startsWith("\t");
}

/** Upstream's `xb`: blank every backtick code span, matching each run to the next run of the same length. */
function blankCodeSpans(text: string): string {
	const runs: Array<{start: number; length: number}> = [];
	for (let at = 0; at < text.length;) {
		if (text[at] !== "`") {
			at += 1;
			continue;
		}
		let end = at;
		while (end < text.length && text[end] === "`") end += 1;
		runs.push({start: at, length: end - at});
		at = end;
	}
	const byLength = new Map<number, number[]>();
	runs.forEach((run, index) => {
		const list = byLength.get(run.length);
		if (list) list.push(index);
		else byLength.set(run.length, [index]);
	});
	const cursor = new Map<number, number>();
	let out = "";
	let kept = 0;
	for (const run of runs) {
		if (run.start < kept) continue;
		const same = byLength.get(run.length) ?? [];
		let next = cursor.get(run.length) ?? 0;
		while (next < same.length && (runs[same[next] ?? 0]?.start ?? 0) <= run.start) next += 1;
		cursor.set(run.length, next);
		if (next === same.length) continue;
		const close = runs[same[next] ?? 0];
		if (close === undefined) continue;
		out += `${text.slice(kept, run.start)} `;
		kept = close.start + close.length;
	}
	return out + text.slice(kept);
}

/** Upstream's `xu`: the text with fenced code, indented code and code spans removed. */
function withoutCode(text: string): string {
	const lines = text.split(/\r?\n/);
	const hasUnindented = lines.some((line) => line.trim() !== "" && !isIndented(line));
	const kept: string[] = [];
	let fence: {char: string; length: number} | null = null;
	let inIndented = false;
	let afterBlank = true;
	for (const line of lines) {
		if (fence) {
			const close = FENCE_CLOSE_RE.exec(line)?.[1];
			if (close !== undefined && close.startsWith(fence.char) && close.length >= fence.length) fence = null;
			continue;
		}
		const open = FENCE_OPEN_RE.exec(line)?.[1];
		if (open !== undefined) {
			fence = {char: open[0] ?? "`", length: open.length};
			inIndented = false;
			afterBlank = false;
			kept.push("");
			continue;
		}
		if (line.trim() === "") {
			afterBlank = true;
			kept.push(line);
			continue;
		}
		if (hasUnindented && isIndented(line) && (inIndented || afterBlank)) {
			inIndented = true;
			afterBlank = false;
			continue;
		}
		inIndented = false;
		afterBlank = false;
		kept.push(line);
	}
	return kept
		.join("\n")
		.split(/\n[ \t]*\n/)
		.map(blankCodeSpans)
		.join("\n\n");
}

/** Upstream's `Ew`: whether a known HTML tag appears outside code. */
function looksLikeHtml(text: string): boolean {
	for (const match of withoutCode(text).matchAll(TAG_RE))
		if (HTML_TAGS.has((match[1] ?? "").toLowerCase())) return true;
	return false;
}

type Sanitize = (html: string) => string;

/** Upstream's `Oc`, once its chunk loads; upstream loads its preview renderer lazily too. */
let sanitize: Sanitize | null = null;
let loading: Promise<void> | null = null;
const sanitizerListeners = new Set<() => void>();

/** Load the HTML preview sanitizer (DOMPurify), once. */
export async function loadPreviewSanitizer(): Promise<void> {
	loading ??= import("./question-option-preview-sanitize").then(({sanitizePreviewHtml}) => {
		sanitize = sanitizePreviewHtml;
		for (const listener of sanitizerListeners) listener();
	});
	return loading;
}

/** Hear when the sanitizer has loaded, starting the load. */
export function subscribePreviewSanitizer(listener: () => void): () => void {
	sanitizerListeners.add(listener);
	void loadPreviewSanitizer();
	return () => {
		sanitizerListeners.delete(listener);
	};
}

/** Whether HTML previews can be sanitized yet. */
export function previewSanitizerLoaded(): boolean {
	return sanitize !== null;
}

function normalizePreview(value: string): string {
	return replaceHiddenChars(value.replace(/\r\n?/g, "\n"));
}

/** Whether a preview is HTML, which needs the sanitizer before it can show. */
export function isHtmlPreview(value: unknown): boolean {
	return typeof value === "string" && value.trim() !== "" && looksLikeHtml(normalizePreview(value));
}

/** Upstream's `tL`. */
function parseUncached(value: string, sanitizeHtml: Sanitize | null): OptionPreview | null | undefined {
	const text = normalizePreview(value);
	if (!looksLikeHtml(text)) return {kind: "text", text};
	if (sanitizeHtml === null) return null;
	const sanitizedHtml = sanitizeHtml(text);
	return sanitizedHtml.trim() === "" ? undefined : {kind: "html", sanitizedHtml};
}

/** Upstream's `Jd`. */
const CACHE_SIZE = 8;
/** Upstream's `wT`: the most recently parsed previews, oldest first. */
const cache = new Map<string, OptionPreview | undefined>();

/**
 * Upstream's `mU`: a blank or non-string preview gives none; otherwise text with CR normalized and
 * hidden characters replaced, or sanitized HTML when a known tag appears outside code. An HTML preview
 * gives none until {@link loadPreviewSanitizer} has loaded, and none on the server.
 */
export function parseOptionPreview(value: unknown): OptionPreview | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	if (cache.has(value)) {
		const hit = cache.get(value);
		cache.delete(value);
		cache.set(value, hit);
		return hit;
	}
	const parsed = parseUncached(value, typeof window === "undefined" ? null : sanitize);
	if (parsed === null) return undefined;
	cache.set(value, parsed);
	if (cache.size > CACHE_SIZE) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	return parsed;
}
