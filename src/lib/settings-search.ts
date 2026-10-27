import {settingsTabLabels} from "./schema-choices";
import {type SettingsTab, SettingsTabSchema} from "./settings-hash";

export interface SettingsIndexEntry {
	tab: SettingsTab;
	rowSlug: string;
	title: string;
	/** Extra phrases that find this row; they match only at rank <= 2 and then score 4. */
	searchPhrases?: readonly string[];
}

/**
 * Every titled Settings row, in tab then DOM order. Like upstream, row titles are indexed, never
 * section headings. tests/settings-search.test.tsx renders each tab and fails when this drifts
 * from the rows the dialog actually shows.
 */
export const SETTINGS_INDEX: readonly SettingsIndexEntry[] = [
	{
		tab: "general",
		rowSlug: "theme",
		title: "Theme",
		searchPhrases: ["dark mode", "light mode", "dark theme", "light theme"],
	},
	{
		tab: "general",
		rowSlug: "transcript-text-size",
		title: "Transcript text size",
		searchPhrases: ["font size"],
	},
	{tab: "general", rowSlug: "transcript-width", title: "Transcript width"},
	{tab: "general", rowSlug: "motion", title: "Motion"},
	{tab: "general", rowSlug: "hide-chrome", title: "Hide chrome"},
	{tab: "general", rowSlug: "response-completions", title: "Response completions"},
	{tab: "general", rowSlug: "code-permission-requests", title: "Code permission requests"},
	{tab: "general", rowSlug: "reset-settings", title: "Reset settings"},
	{tab: "claude-code", rowSlug: "terminal-colors", title: "Terminal colors"},
	{tab: "claude-code", rowSlug: "code-font", title: "Code font"},
	{tab: "claude-code", rowSlug: "interface-font", title: "Interface font"},
	{tab: "claude-code", rowSlug: "default-transcript-view", title: "Default transcript view"},
	{
		tab: "claude-code",
		rowSlug: "connect-new-sessions-to-remote-control",
		title: "Connect new sessions to Remote Control",
	},
	{tab: "claude-code", rowSlug: "allow-bypass-permissions-mode", title: "Allow bypass permissions mode"},
	{tab: "claude-code", rowSlug: "dynamic-workflows", title: "Dynamic workflows"},
	{tab: "claude-code", rowSlug: "archive-inactive-sessions", title: "Archive inactive sessions"},
	{
		tab: "claude-code",
		rowSlug: "output-style",
		title: "Output style",
		searchPhrases: ["concise", "terse", "brief", "response style"],
	},
	{tab: "claude-code", rowSlug: "local-sandbox", title: "Local sandbox"},
	{tab: "transcript", rowSlug: "thinking", title: "Thinking"},
	{tab: "transcript", rowSlug: "tools", title: "Tools"},
	{tab: "transcript", rowSlug: "tool-duration", title: "Tool duration"},
	{tab: "transcript", rowSlug: "debug", title: "Debug"},
	{tab: "transcript", rowSlug: "passed-hooks", title: "Passed hooks"},
	{tab: "transcript", rowSlug: "hook-warnings", title: "Hook warnings"},
	{tab: "transcript", rowSlug: "hook-errors", title: "Hook errors"},
	{tab: "transcript", rowSlug: "system-banners", title: "System banners"},
	{
		tab: "transcript",
		rowSlug: "show-compact-summaries-inline",
		title: "Show compact summaries inline",
	},
	{
		tab: "transcript",
		rowSlug: "show-transcript-only-system-records",
		title: "Show transcript-only system records",
	},
	{tab: "sessions", rowSlug: "active-session-order", title: "Active session order"},
	{tab: "sessions", rowSlug: "sessions-page-grouping", title: "Sessions page grouping"},
	{tab: "sessions", rowSlug: "active-timeout-seconds", title: "Active timeout (seconds)"},
	{tab: "sessions", rowSlug: "show-ai-titles", title: "Show AI titles"},
	{
		tab: "sessions",
		rowSlug: "show-working-copy-changes-strip",
		title: "Show working-copy changes strip",
	},
	{
		tab: "sessions",
		rowSlug: "offer-to-review-uncommitted-changes",
		title: "Offer to review uncommitted changes",
	},
	{tab: "sessions", rowSlug: "default-view", title: "Default view"},
	{tab: "application", rowSlug: "terminal-host", title: "Terminal host"},
	{tab: "application", rowSlug: "live-terminal-input", title: "Live terminal input"},
	{tab: "application", rowSlug: "shell-tabs", title: "Shell tabs"},
	{tab: "ai-features", rowSlug: "summary-button", title: "Summary button"},
	{tab: "ai-features", rowSlug: "working-copy-review", title: "Working-copy review"},
	{tab: "ai-features", rowSlug: "review-behavior", title: "Review behavior"},
	{tab: "ai-features", rowSlug: "session-context-brief", title: "Session context brief"},
	{tab: "ai-features", rowSlug: "read-only-mcp-server", title: "Read-only MCP server"},
	{
		tab: "claude-config",
		rowSlug: "claude-code-settings-files",
		title: "Claude Code settings files",
	},
];

/**
 * Extra words that find a whole section (upstream's per-section keyword map). A keyword-only hit
 * scores 10, after every name and row hit.
 */
export const SETTINGS_SECTION_KEYWORDS: Partial<Record<SettingsTab, readonly string[]>> = {
	usage: ["overage", "extra usage", "spend limit", "usage credits"],
	"claude-config": ["settings.json"],
	application: ["herdr", "tmux"],
};

/**
 * Upstream's query normaliser: NFKD, lowercase, accents stripped, smart quotes folded, and runs of
 * whitespace, hyphens and underscores collapsed to one space.
 */
export function normalizeSettingsQuery(query: string): string {
	return query
		.normalize("NFKD")
		.toLowerCase()
		.replaceAll(/[\u0300-\u036f]/g, "")
		.replaceAll(/[\u2018\u2019\u201b]/g, "'")
		.replaceAll(/[\u201c\u201d]/g, '"')
		.replaceAll(/[\s\-_\u2010-\u2015]+/g, " ")
		.trim();
}

/**
 * How well `query` matches `label`: 0 equal ignoring spaces, 1 prefix ignoring spaces, 2 every
 * query word starts some word-suffix of the label (order-free), 3 every query word is a substring,
 * -1 no match.
 */
export function rankSettingsLabel(query: string, label: string): number {
	const needle = normalizeSettingsQuery(query);
	if (needle === "") return -1;
	const haystack = normalizeSettingsQuery(label);
	const needleWords = needle.split(" ");
	const labelWords = haystack.split(" ");
	const compactNeedle = needleWords.join("");
	const compactLabel = labelWords.join("");
	if (compactLabel === compactNeedle) return 0;
	if (compactLabel.startsWith(compactNeedle)) return 1;
	const suffixes = labelWords.map((_, index) => labelWords.slice(index).join(""));
	if (needleWords.every((word) => suffixes.some((suffix) => suffix.startsWith(word)))) return 2;
	if (needleWords.every((word) => haystack.includes(word))) return 3;
	return -1;
}

const PHRASE_RANK = 4;

/** A row's rank: its title rank, else 4 when a search phrase matches at rank <= 2, else -1. */
function rankEntry(query: string, entry: SettingsIndexEntry): number {
	const rank = rankSettingsLabel(query, entry.title);
	if (rank !== -1) return rank;
	const phraseHit = (entry.searchPhrases ?? []).some((phrase) => {
		const phraseRank = rankSettingsLabel(query, phrase);
		return phraseRank !== -1 && phraseRank <= 2;
	});
	return phraseHit ? PHRASE_RANK : -1;
}

export interface RankedSettingsRow {
	entry: SettingsIndexEntry;
	rank: number;
}

export interface RankedSettingsSection {
	tab: SettingsTab;
	/** Name rank (0-3), else 5 + best row rank, else 10 for a keyword-only hit. */
	score: number;
	/** The keyword that found a keyword-only section. */
	keyword?: string;
	/** Matching rows, best rank first, ties in index order. */
	rows: RankedSettingsRow[];
}

const ROW_SCORE_BASE = 5;
const KEYWORD_SCORE = 10;

/** Every section that matches `query`, by score then nav order. */
export function rankSettingsSections(query: string): RankedSettingsSection[] {
	if (normalizeSettingsQuery(query) === "") return [];
	return SettingsTabSchema.options
		.flatMap((tab): RankedSettingsSection[] => {
			const rows = SETTINGS_INDEX.filter((entry) => entry.tab === tab)
				.map((entry) => ({entry, rank: rankEntry(query, entry)}))
				.filter((row) => row.rank !== -1)
				.toSorted((a, b) => a.rank - b.rank);
			const nameRank = rankSettingsLabel(query, settingsTabLabels[tab]);
			if (nameRank !== -1) return [{tab, score: nameRank, rows}];
			const [best] = rows;
			if (best !== undefined) return [{tab, score: ROW_SCORE_BASE + best.rank, rows}];
			const keyword = SETTINGS_SECTION_KEYWORDS[tab]?.find(
				(candidate) => rankSettingsLabel(query, candidate) !== -1,
			);
			return keyword === undefined ? [] : [{tab, score: KEYWORD_SCORE, keyword, rows}];
		})
		.toSorted((a, b) => a.score - b.score);
}

/** True when the character before `start` is not a letter or digit. */
function isWordStart(title: string, start: number): boolean {
	return start === 0 || /[^a-z0-9]/i.test(title.charAt(start - 1));
}

/**
 * Where to highlight `query` in `label`: the first word-start occurrence of the trimmed, lowercased
 * query, else its first occurrence, else -1. Rows found through phrases, collapsed spaces or
 * out-of-order words have no literal match and get no highlight.
 */
export function settingsMatchStart(label: string, query: string): number {
	const haystack = label.toLowerCase();
	const needle = query.trim().toLowerCase();
	if (needle === "") return -1;
	let first = -1;
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
		if (first === -1) first = at;
		if (isWordStart(haystack, at)) return at;
	}
	return first;
}

/**
 * One popover row: a section `hit` (optionally with a via line naming the matched row or keyword),
 * a `child` row indented under its section, or a "+N more" row.
 */
export type SettingsResultRow =
	| {kind: "hit"; tab: SettingsTab; via?: string; rowSlug?: string}
	| {kind: "child"; tab: SettingsTab; rowSlug: string; title: string}
	| {kind: "more"; tab: SettingsTab; count: number};

/** Upstream's `tn`: children shown under a section before "+N more". */
const MAX_CHILDREN = 3;
/** Upstream's `nn`: shorter queries show one via-hit per section. */
const MIN_CHILD_QUERY_LENGTH = 2;

function viaHit(tab: SettingsTab, entry: SettingsIndexEntry): SettingsResultRow {
	return {kind: "hit", tab, via: entry.title, rowSlug: entry.rowSlug};
}

/**
 * Upstream's `fn` over ranked sections. A 1-character query gives one hit per section with its
 * first matching row (or keyword) on a via line. Longer queries give a section-name match, or a
 * section with several matching rows, a hit then up to three children and "+N more" (all children
 * when the section is in `expanded`); a single matching row becomes a via-hit, and a keyword-only
 * match a hit with the keyword as via. Row labels already shown under an earlier section are
 * dropped.
 */
export function layoutSettingsResultRows(
	sections: readonly RankedSettingsSection[],
	query: string,
	expanded: ReadonlySet<SettingsTab>,
): SettingsResultRow[] {
	const short = normalizeSettingsQuery(query).length < MIN_CHILD_QUERY_LENGTH;
	const shown = new Set<string>();
	return sections.flatMap(({tab, score, keyword, rows}): SettingsResultRow[] => {
		const entries = rows.map((row) => row.entry).filter((entry) => !shown.has(entry.title));
		const [first] = entries;
		if (short || (score >= ROW_SCORE_BASE && entries.length === 1)) {
			if (first !== undefined) {
				shown.add(first.title);
				return [viaHit(tab, first)];
			}
			return [keyword === undefined ? {kind: "hit", tab} : {kind: "hit", tab, via: keyword}];
		}
		if (first === undefined) {
			return [keyword === undefined ? {kind: "hit", tab} : {kind: "hit", tab, via: keyword}];
		}
		const visible = expanded.has(tab) ? entries : entries.slice(0, MAX_CHILDREN);
		for (const entry of visible) shown.add(entry.title);
		const hidden = entries.length - visible.length;
		return [
			{kind: "hit", tab},
			...visible.map((entry): SettingsResultRow => ({
				kind: "child",
				tab,
				rowSlug: entry.rowSlug,
				title: entry.title,
			})),
			...(hidden > 0 ? [{kind: "more" as const, tab, count: hidden}] : []),
		];
	});
}

/** The popover rows for `query`, with the tabs in `expanded` showing every child. */
export function buildSettingsResultRows(query: string, expanded: ReadonlySet<SettingsTab>): SettingsResultRow[] {
	return layoutSettingsResultRows(rankSettingsSections(query), query, expanded);
}

/** Split `title` into the text before, inside and after a match of `length` at `start`. */
export function splitMatch(
	title: string,
	start: number,
	length: number,
): {before: string; match: string; after: string} {
	return {
		before: title.slice(0, start),
		match: title.slice(start, start + length),
		after: title.slice(start + length),
	};
}
