export interface TextMatch {
	start: number;
	end: number;
}

export interface Snippet {
	text: string;
	matches: TextMatch[];
}

export type RelativeBucket =
	| "Just now"
	| "Past hour"
	| "Today"
	| "Yesterday"
	| "Past week"
	| "Past month"
	| "Past year";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Upstream's search-row meta bucket; `null` renders an empty meta cell. */
export function relativeBucket(mtime: number, now: number): RelativeBucket | null {
	const diff = now - mtime;
	if (diff < 5 * MINUTE_MS) return "Just now";
	if (diff < HOUR_MS) return "Past hour";
	const today = new Date(now);
	const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
	if (mtime >= startOfToday) return "Today";
	const startOfYesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
	if (mtime >= startOfYesterday) return "Yesterday";
	if (diff < 7 * DAY_MS) return "Past week";
	if (diff < 30 * DAY_MS) return "Past month";
	if (diff < 365 * DAY_MS) return "Past year";
	return null;
}

const WORDS_BEFORE = 1;
const WORDS_AFTER = 3;
const WIDTH_BEFORE = 12;
const WIDTH_AFTER = 24;
const CJK = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3fffd}]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function charWidth(char: string): number {
	return CJK.test(char) ? 2 : 1;
}

function textWidth(text: string): number {
	let width = 0;
	for (const char of text) width += charWidth(char);
	return width;
}

function longestPrefix(text: string, maxWidth: number): string {
	let width = 0;
	let length = 0;
	for (const char of text) {
		width += charWidth(char);
		if (width > maxWidth) break;
		length += char.length;
	}
	return text.slice(0, length);
}

function longestSuffix(text: string, maxWidth: number): string {
	let start = text.length;
	let width = 0;
	while (start > 0) {
		const codeUnits = start > 1 && /[\udc00-\udfff]/.test(text[start - 1] ?? "") ? 2 : 1;
		width += charWidth(text.slice(start - codeUnits, start));
		if (width > maxWidth) break;
		start -= codeUnits;
	}
	return text.slice(start);
}

function isEmphasisMarker(text: string, i: number): boolean {
	const char = text[i];
	if (char === "*") return true;
	if (char === "~") return text[i + 1] === "~" || text[i - 1] === "~";
	if (char === "_") {
		const inWord = WORD_CHAR.test(text[i - 1] ?? "") && WORD_CHAR.test(text[i + 1] ?? "");
		return !inWord;
	}
	return false;
}

/** Collapses whitespace (incl. newlines), strips markdown emphasis, and re-maps match offsets. */
function cleanSnippet(text: string, matches: readonly TextMatch[]): Snippet {
	let out = "";
	const positions: number[] = [];
	for (let i = 0; i < text.length; i++) {
		positions.push(out.length);
		const char = text[i] ?? "";
		if (isEmphasisMarker(text, i)) continue;
		if (/\s/.test(char)) {
			if (!out.endsWith(" ")) out += " ";
			continue;
		}
		out += char;
	}
	positions.push(out.length);
	return {text: out, matches: remapMatches(matches, (offset) => positions[offset] ?? out.length)};
}

function remapMatches(matches: readonly TextMatch[], map: (offset: number) => number): TextMatch[] {
	return matches
		.map((match) => ({start: map(match.start), end: map(match.end)}))
		.filter((match) => match.end > match.start)
		.sort((a, b) => a.start - b.start);
}

function clipMatches(matches: readonly TextMatch[], start: number, end: number): TextMatch[] {
	return remapMatches(matches, (offset) => Math.min(Math.max(offset, start), end) - start);
}

function takeBefore(before: string): string {
	const chunks = before.match(/\S+\s*|\s+/g) ?? [];
	let taken = "";
	for (let i = chunks.length - 1, count = 0; i >= 0 && count < WORDS_BEFORE; i--, count++) {
		const chunk = chunks[i] ?? "";
		const remaining = WIDTH_BEFORE - textWidth(taken);
		if (textWidth(chunk) > remaining) {
			if (count === 0) taken = longestSuffix(chunk, remaining);
			break;
		}
		taken = chunk + taken;
	}
	return taken;
}

function takeAfter(after: string): string {
	const chunks = after.match(/\s*\S+/g) ?? [];
	let taken = "";
	for (const [count, chunk] of chunks.slice(0, WORDS_AFTER).entries()) {
		const remaining = WIDTH_AFTER - textWidth(taken);
		if (textWidth(chunk) > remaining) {
			if (count === 0) taken = longestPrefix(chunk, remaining);
			break;
		}
		taken += chunk;
	}
	return taken;
}

function stripEllipses(snippet: Snippet): Snippet {
	const lead = /^(?:\.\.\.|…|\s)+/.exec(snippet.text)?.[0].length ?? 0;
	const text = snippet.text.slice(lead).replace(/(?:\.\.\.|…|\s)+$/, "");
	return {text, matches: clipMatches(snippet.matches, lead, lead + text.length)};
}

/**
 * Ports upstream's `Up()`: re-trims a server snippet around its first match to one word
 * before and three after (capped at 12 and 24 chars, CJK counting double).
 */
export function trimSnippet(text: string, matches: readonly TextMatch[]): Snippet {
	const cleaned = cleanSnippet(text, matches);
	const [first] = cleaned.matches;
	if (first === undefined) return stripEllipses(cleaned);
	const before = takeBefore(cleaned.text.slice(0, first.start));
	const after = takeAfter(cleaned.text.slice(first.end));
	const windowStart = first.start - before.length;
	const windowEnd = first.end + after.length;
	return stripEllipses({
		text: cleaned.text.slice(windowStart, windowEnd),
		matches: clipMatches(cleaned.matches, windowStart, windowEnd),
	});
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The palette's instant client-side title match: every whitespace-separated
 * term must occur (case-insensitively); returns each occurrence, or `null`.
 */
export function titleMatches(title: string, query: string): TextMatch[] | null {
	const terms = query
		.trim()
		.split(/\s+/u)
		.filter((term) => term !== "");
	if (terms.length === 0) return null;
	const lower = title.toLowerCase();
	if (!terms.every((term) => lower.includes(term.toLowerCase()))) return null;
	const pattern = new RegExp(terms.map(escapeRegExp).join("|"), "giu");
	return [...title.matchAll(pattern)].map((match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}));
}
