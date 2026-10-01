import type {SettingsTab} from "./settings-hash";

export interface SettingsIndexEntry {
	tab: SettingsTab;
	rowSlug: string;
	title: string;
}

/**
 * Every titled Settings row, in tab then DOM order. Like upstream, only row titles are indexed,
 * never section headings. tests/settings-search.test.tsx renders each tab and fails when this
 * drifts from the rows the dialog actually shows.
 */
export const SETTINGS_INDEX: readonly SettingsIndexEntry[] = [
	{tab: "general", rowSlug: "theme", title: "Theme"},
	{tab: "general", rowSlug: "motion", title: "Motion"},
	{tab: "general", rowSlug: "hide-chrome", title: "Hide chrome"},
	{tab: "general", rowSlug: "recent-plans-and-memories", title: "Recent plans and memories"},
	{tab: "general", rowSlug: "response-completions", title: "Response completions"},
	{tab: "general", rowSlug: "code-permission-requests", title: "Code permission requests"},
	{tab: "claude-code", rowSlug: "terminal-colors", title: "Terminal colors"},
	{tab: "claude-code", rowSlug: "code-font", title: "Code font"},
	{tab: "claude-code", rowSlug: "interface-font", title: "Interface font"},
	{tab: "claude-code", rowSlug: "transcript-text-size", title: "Transcript text size"},
	{tab: "claude-code", rowSlug: "transcript-width", title: "Transcript width"},
	{tab: "claude-code", rowSlug: "default-transcript-view", title: "Default transcript view"},
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
	{tab: "sessions", rowSlug: "default-view", title: "Default view"},
	{tab: "application", rowSlug: "live-herdr-input", title: "Live Herdr input"},
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

export interface SettingsSearchResult extends SettingsIndexEntry {
	/** Index of the match in `title`; the match is `query.trim().length` characters long. */
	start: number;
}

export interface SettingsSearchGroup {
	tab: SettingsTab;
	results: SettingsSearchResult[];
}

/** 0 = title prefix, 1 = word start, 2 = mid-word. */
function matchRank(title: string, start: number): number {
	if (start === 0) return 0;
	return /[^a-z0-9]/i.test(title.charAt(start - 1)) ? 1 : 2;
}

/** The first word-start occurrence of `needle` in `haystack`, else the first occurrence. */
function bestMatch(haystack: string, needle: string): number {
	let first = -1;
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
		if (first === -1) first = at;
		if (matchRank(haystack, at) < 2) return at;
	}
	return first;
}

/**
 * Case-insensitive substring search over row titles. Results are ranked (title prefix, then word
 * start, then mid-word; ties keep index order) and grouped by tab, with groups ordered by their
 * best result.
 */
export function searchSettings(query: string): SettingsSearchGroup[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [];

	const ranked = SETTINGS_INDEX.flatMap((entry, order) => {
		const start = bestMatch(entry.title.toLowerCase(), needle);
		return start === -1 ? [] : [{result: {...entry, start}, order}];
	}).sort(
		(a, b) =>
			matchRank(a.result.title, a.result.start) - matchRank(b.result.title, b.result.start) || a.order - b.order,
	);

	const groups = new Map<SettingsTab, SettingsSearchResult[]>();
	for (const {result} of ranked) {
		const group = groups.get(result.tab);
		if (group === undefined) groups.set(result.tab, [result]);
		else group.push(result);
	}
	return [...groups].map(([tab, results]) => ({tab, results}));
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
