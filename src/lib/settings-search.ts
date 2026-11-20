import type {CustomizeTarget} from "../components/customize/customize-navigation";
import {assertNever} from "./assert-never";
import {customizeSectionLabels, settingsTabLabels} from "./schema-choices";
import {type CustomizeSection, type SettingsTab, SettingsTabSchema} from "./settings-hash";
import {type SettingsNavMemberKey, type SettingsSearchName, settingsSearchNames} from "./settings-nav";

export interface SettingsIndexEntry
{
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
		rowSlug: "interface-font",
		title: "Interface font",
	},
	{
		tab: "general",
		rowSlug: "response-font",
		title: "Response font",
	},
	{
		tab: "general",
		rowSlug: "transcript-text-size",
		title: "Transcript text size",
		searchPhrases: ["font size"],
	},
	{
		tab: "general",
		rowSlug: "transcript-width",
		title: "Transcript width",
	},
	{
		tab: "general",
		rowSlug: "motion",
		title: "Motion",
	},
	{
		tab: "general",
		rowSlug: "hide-chrome",
		title: "Hide chrome",
	},
	{
		tab: "general",
		rowSlug: "terminal-colors",
		title: "Terminal colors",
	},
	{
		tab: "general",
		rowSlug: "code-font",
		title: "Code font",
	},
	{
		tab: "general",
		rowSlug: "code-font-size",
		title: "Code font size",
		searchPhrases: ["editor font size", "terminal font size"],
	},
	{
		tab: "general",
		rowSlug: "reset-settings",
		title: "Reset settings",
	},
	{
		tab: "notifications",
		rowSlug: "response-completions",
		title: "Response completions",
	},
	{
		tab: "notifications",
		rowSlug: "code-permission-requests",
		title: "Code permission requests",
	},
	{
		tab: "notifications",
		rowSlug: "notification-sound",
		title: "Notification sound",
	},
	{
		tab: "claude-code",
		rowSlug: "default-transcript-view",
		title: "Default transcript view",
	},
	{
		tab: "claude-code",
		rowSlug: "dynamic-workflows",
		title: "Dynamic workflows",
	},
	{
		tab: "claude-code",
		rowSlug: "switch-models-local",
		title: "Switch models in Claude Code on this computer",
		searchPhrases: ["Switch models when a message is flagged"],
	},
	{
		tab: "claude-code",
		rowSlug: "output-style",
		title: "Output style",
		searchPhrases: ["concise", "terse", "brief", "response style"],
	},
	{
		tab: "claude-code",
		rowSlug: "allow-bypass-permissions-mode",
		title: "Allow bypass permissions mode",
	},
	{
		tab: "claude-code",
		rowSlug: "archive-inactive-sessions",
		title: "Archive inactive sessions",
	},
	{
		tab: "claude-code",
		rowSlug: "local-sandbox",
		title: "Local sandbox",
	},
	{
		tab: "claude-code",
		rowSlug: "strict-sandbox-mode",
		title: "Strict sandbox mode",
	},
	{
		tab: "claude-code",
		rowSlug: "connect-new-sessions-to-remote-control",
		title: "Connect new sessions to Remote Control",
	},
	{
		tab: "transcript",
		rowSlug: "thinking",
		title: "Thinking",
	},
	{
		tab: "transcript",
		rowSlug: "tools",
		title: "Tools",
	},
	{
		tab: "transcript",
		rowSlug: "tool-duration",
		title: "Tool duration",
	},
	{
		tab: "transcript",
		rowSlug: "debug",
		title: "Debug",
	},
	{
		tab: "transcript",
		rowSlug: "passed-hooks",
		title: "Passed hooks",
	},
	{
		tab: "transcript",
		rowSlug: "hook-warnings",
		title: "Hook warnings",
	},
	{
		tab: "transcript",
		rowSlug: "hook-errors",
		title: "Hook errors",
	},
	{
		tab: "transcript",
		rowSlug: "system-banners",
		title: "System banners",
	},
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
	{
		tab: "sessions",
		rowSlug: "active-session-order",
		title: "Active session order",
	},
	{
		tab: "sessions",
		rowSlug: "sessions-page-grouping",
		title: "Sessions page grouping",
	},
	{
		tab: "sessions",
		rowSlug: "active-timeout-seconds",
		title: "Active timeout (seconds)",
	},
	{
		tab: "sessions",
		rowSlug: "show-ai-titles",
		title: "Show AI titles",
	},
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
	{
		tab: "sessions",
		rowSlug: "default-view",
		title: "Default view",
	},
	{
		tab: "application",
		rowSlug: "terminal-host",
		title: "Terminal host",
	},
	{
		tab: "application",
		rowSlug: "live-terminal-input",
		title: "Live terminal input",
	},
	{
		tab: "application",
		rowSlug: "shell-tabs",
		title: "Shell tabs",
	},
	{
		tab: "ai-features",
		rowSlug: "summary-button",
		title: "Summary button",
	},
	{
		tab: "ai-features",
		rowSlug: "working-copy-review",
		title: "Working-copy review",
	},
	{
		tab: "ai-features",
		rowSlug: "review-behavior",
		title: "Review behavior",
	},
	{
		tab: "ai-features",
		rowSlug: "session-context-brief",
		title: "Session context brief",
	},
	{
		tab: "ai-features",
		rowSlug: "read-only-mcp-server",
		title: "Read-only MCP server",
	},
	{
		tab: "claude-config",
		rowSlug: "claude-code-settings-files",
		title: "Claude Code settings files",
	},
];

/** A Customize section as a search section (upstream's `customize-*` section ids). */
export type CustomizeSearchSection = `customize-${CustomizeSection}`;

/** Every section the Settings search lists: the settings tabs, then Skills, Connectors and Plugins. */
export type SettingsSearchSection = SettingsTab | CustomizeSearchSection;

/** The Customize search sections in nav order. */
const CUSTOMIZE_SEARCH_SECTIONS = [
	"customize-skills",
	"customize-connectors",
	"customize-plugins",
] as const satisfies readonly CustomizeSearchSection[];

export function isCustomizeSearchSection(section: SettingsSearchSection): section is CustomizeSearchSection
{
	return section.startsWith("customize-");
}

/** The Customize section a `customize-*` search section opens. */
export function customizeSectionOf(section: CustomizeSearchSection): CustomizeSection
{
	switch (section)
	{
		case "customize-skills":
			return "skills";
		case "customize-connectors":
			return "connectors";
		case "customize-plugins":
			return "plugins";
		default:
			return assertNever(section);
	}
}

/** One searchable Customize row: a skill, custom command, connector, plugin or plugin skill. */
export interface CustomizeIndexEntry
{
	/** The row's target as a stable key; upstream's `subpathId`. */
	rowSlug: string;
	/** What the row shows ("fix · build" for a plugin skill). */
	title: string;
	/** What the query ranks against when it differs from the title ("fix build"). */
	searchText?: string;
	target: CustomizeTarget;
	/** Rows sharing this key show once per section (upstream `collapseKey`). */
	collapseKey?: string;
}

export type CustomizeSearchIndex = Readonly<Record<CustomizeSearchSection, readonly CustomizeIndexEntry[]>>;

/**
 * Extra words that find a whole section (upstream's per-section keyword map `vn`). A keyword-only hit
 * scores 10, after every name and row hit.
 */
export const SETTINGS_SECTION_KEYWORDS: Partial<Record<SettingsSearchSection, readonly string[]>> =
{
	usage: ["overage", "extra usage", "spend limit", "usage credits"],
	"claude-config": ["settings.json"],
	application: ["herdr", "tmux"],
	"customize-connectors": ["mcp", "integrations", "tools"],
	"customize-skills": ["custom instructions", "agent skills"],
	"customize-plugins": ["marketplace", "extensions"],
};

/**
 * Upstream's query normaliser: NFKD, lowercase, accents stripped, smart quotes folded, and runs of
 * whitespace, hyphens and underscores collapsed to one space.
 */
export function normalizeSettingsQuery(query: string): string
{
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
 * query word starts some word-suffix of the label (order-free), 3 every query word is a substring
 * of the label without its spaces, -1 no match.
 */
export function rankSettingsLabel(query: string, label: string): number
{
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
	if (needleWords.every((word) => compactLabel.includes(word))) return 3;
	return -1;
}

/** Upstream's keyword test: the keyword without spaces contains the query without spaces. */
function keywordMatches(query: string, keyword: string): boolean
{
	const needle = normalizeSettingsQuery(query).replaceAll(" ", "");
	return needle !== "" && normalizeSettingsQuery(keyword).replaceAll(" ", "").includes(needle);
}

const PHRASE_RANK = 4;

/** A row's rank: its title rank, else 4 when a search phrase matches at rank <= 2, else -1. */
function rankEntry(query: string, entry: SettingsIndexEntry): number
{
	const rank = rankSettingsLabel(query, entry.title);
	if (rank !== -1) return rank;
	const phraseHit = (entry.searchPhrases ?? []).some((phrase) =>
	{
		const phraseRank = rankSettingsLabel(query, phrase);
		return phraseRank !== -1 && phraseRank <= 2;
	});
	return phraseHit ? PHRASE_RANK : -1;
}

/** A settings row or a Customize row. */
export type SettingsSearchEntry = SettingsIndexEntry | CustomizeIndexEntry;

export interface RankedSettingsRow
{
	entry: SettingsSearchEntry;
	rank: number;
}

export interface RankedSettingsSection
{
	tab: SettingsSearchSection;
	/** Name rank (0-3), else 5 + best row rank, else 10 for a keyword-only hit. */
	score: number;
	/** The keyword that found a keyword-only section. */
	keyword?: string;
	/** The `alsoFoundBy` name (e.g. "General" for Appearance) that matched when the section name did not. */
	alias?: string;
	/** Matching rows, best rank first, ties in index order. */
	rows: RankedSettingsRow[];
}

const ROW_SCORE_BASE = 5;
const KEYWORD_SCORE = 10;

/** Upstream's `gn` gate: `alsoFoundBy` names only match queries of 2+ characters. */
const MIN_ALIAS_QUERY_LENGTH = 2;

type SettingsSearchNames = Partial<Record<SettingsNavMemberKey, SettingsSearchName>>;

/** The nav table's renames and aliases (upstream `searchNames`). */
const NAV_SEARCH_NAMES: SettingsSearchNames = settingsSearchNames();

/**
 * The section's name in search results: its nav row's new name (Appearance, Code), else its tab label;
 * a Customize section by its nav label.
 */
export function settingsSectionName(tab: SettingsSearchSection): string
{
	if (isCustomizeSearchSection(tab)) return customizeSectionLabels[customizeSectionOf(tab)];
	return NAV_SEARCH_NAMES[tab]?.name ?? settingsTabLabels[tab];
}

/** The first `alsoFoundBy` name that matches, with its rank. */
function matchAlias(
	query: string,
	aliases: readonly string[],
):
	|
	  {
			alias: string;
			rank: number;
	  }
	| undefined
{
	for (const alias of aliases)
	{
		const rank = rankSettingsLabel(query, alias);
		if (rank !== -1)
			return {
				alias,
				rank,
			};
	}
	return undefined;
}

/** Upstream's section scoring: name rank, else alias rank, else 5 + best row rank, else 10 for a keyword. */
function scoreSection(
	query: string,
	tab: SettingsSearchSection,
	name: string,
	aliases: readonly string[],
	rows: RankedSettingsRow[],
): RankedSettingsSection[]
{
	const nameRank = rankSettingsLabel(query, name);
	if (nameRank !== -1)
		return [
			{
				tab,
				score: nameRank,
				rows,
			},
		];
	const aliasesApply = normalizeSettingsQuery(query).length >= MIN_ALIAS_QUERY_LENGTH;
	const aliasMatch = aliasesApply ? matchAlias(query, aliases) : undefined;
	if (aliasMatch !== undefined)
		return [
			{
				tab,
				score: aliasMatch.rank,
				alias: aliasMatch.alias,
				rows,
			},
		];
	const [best] = rows;
	if (best !== undefined)
		return [
			{
				tab,
				score: ROW_SCORE_BASE + best.rank,
				rows,
			},
		];
	const keyword = SETTINGS_SECTION_KEYWORDS[tab]?.find((candidate) => keywordMatches(query, candidate));
	return keyword === undefined
		? []
		: [
				{
					tab,
					score: KEYWORD_SCORE,
					keyword,
					rows,
				},
			];
}

/** Matching rows, best rank first, ties in index order. */
function rankRows<T extends SettingsSearchEntry>(
	entries: readonly T[],
	rankOf: (entry: T) => number,
): RankedSettingsRow[]
{
	return entries
		.map((entry) => (
		{
			entry,
			rank: rankOf(entry),
		}))
		.filter((row) => row.rank !== -1)
		.toSorted((a, b) => a.rank - b.rank);
}

/**
 * Every section that matches `query`, by score then nav order: the settings tabs, then (given their index)
 * Skills, Connectors and Plugins. A section renamed by its nav row ranks by the new name, then (for 2+
 * character queries) by its aliases; a row titled like the new name is dropped.
 */
export function rankSettingsSections(
	query: string,
	searchNames: SettingsSearchNames = NAV_SEARCH_NAMES,
	customize?: CustomizeSearchIndex,
): RankedSettingsSection[]
{
	if (normalizeSettingsQuery(query) === "") return [];
	const settings = SettingsTabSchema.options.flatMap((tab): RankedSettingsSection[] =>
	{
		const searchName = searchNames[tab];
		const name = searchName?.name ?? settingsTabLabels[tab];
		const entries = SETTINGS_INDEX.filter(
			(entry) =>
				entry.tab === tab &&
				(searchName?.name === undefined || entry.title.toLowerCase() !== name.toLowerCase()),
		);
		const rows = rankRows(entries, (entry) => rankEntry(query, entry));
		return scoreSection(query, tab, name, searchName?.alsoFoundBy ?? [], rows);
	});
	const customizeSections =
		customize === undefined
			? []
			: CUSTOMIZE_SEARCH_SECTIONS.flatMap((tab) =>
					scoreSection(
						query,
						tab,
						settingsSectionName(tab),
						[],
						rankRows(customize[tab], (entry) => rankSettingsLabel(query, entry.searchText ?? entry.title)),
					),
				);
	return [...settings, ...customizeSections].toSorted((a, b) => a.score - b.score);
}

/** True when the character before `start` is not a letter or digit. */
function isWordStart(title: string, start: number): boolean
{
	return start === 0 || /[^a-z0-9]/i.test(title.charAt(start - 1));
}

/**
 * Where to highlight `query` in `label`: the first word-start occurrence of the trimmed, lowercased
 * query, else its first occurrence, else -1. Rows found through phrases, collapsed spaces or
 * out-of-order words have no literal match and get no highlight.
 */
export function settingsMatchStart(label: string, query: string): number
{
	const haystack = label.toLowerCase();
	const needle = query.trim().toLowerCase();
	if (needle === "") return -1;
	let first = -1;
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1))
	{
		if (first === -1) first = at;
		if (isWordStart(haystack, at)) return at;
	}
	return first;
}

/**
 * One popover row: a section `hit` (optionally with a via line naming the matched row or keyword),
 * a `child` row indented under its section, or a "+N more" row. Customize rows carry the `target` they open.
 */
export type SettingsResultRow =
	|
	  {
			kind: "hit";
			tab: SettingsSearchSection;
			via?: string;
			rowSlug?: string;
			target?: CustomizeTarget;
	  }
	|
	  {
			kind: "child";
			tab: SettingsSearchSection;
			rowSlug: string;
			title: string;
			target?: CustomizeTarget;
	  }
	|
	  {
			kind: "more";
			tab: SettingsSearchSection;
			count: number;
	  };

/** Upstream's `tn`: children shown under a section before "+N more". */
const MAX_CHILDREN = 3;
/** Upstream's `nn`: shorter queries show one via-hit per section. */
const MIN_CHILD_QUERY_LENGTH = 2;

/** A Customize entry's target as a row field; settings rows have none. */
function targetOf(entry: SettingsSearchEntry):
{
	target?: CustomizeTarget;
}
{
	return "target" in entry
		?
			{
				target: entry.target,
			}
		: {};
}

function viaHit(tab: SettingsSearchSection, entry: SettingsSearchEntry): SettingsResultRow
{
	return {
		kind: "hit",
		tab,
		via: entry.title,
		rowSlug: entry.rowSlug,
		...targetOf(entry),
	};
}

/** Upstream's `mn` dedupe key: the collapse key, else the label and target. */
function dedupeKey(entry: SettingsSearchEntry): string
{
	const collapseKey = "collapseKey" in entry ? entry.collapseKey : undefined;
	return collapseKey ?? `${entry.title}\0${entry.rowSlug}`;
}

/** The first entry of each dedupe key, which is the best-ranked. */
function uniqueEntries(entries: readonly SettingsSearchEntry[]): SettingsSearchEntry[]
{
	const seen = new Set<string>();
	return entries.filter((entry) =>
	{
		const key = dedupeKey(entry);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * One section's rows. Settings sections skip row labels already in `shown` and add theirs; Customize
 * sections neither skip nor add (upstream's `r` flag for `customize-*` sections).
 */
function layoutSection(
	{tab, score, keyword, alias, rows}: RankedSettingsSection,
	short: boolean,
	expanded: ReadonlySet<SettingsSearchSection>,
	shown: Set<string>,
): SettingsResultRow[]
{
	const customize = isCustomizeSearchSection(tab);
	const entries = uniqueEntries(rows.map((row) => row.entry)).filter((entry) => customize || !shown.has(entry.title));
	const show = (entry: SettingsSearchEntry) =>
	{
		if (!customize) shown.add(entry.title);
	};
	const keywordHit: SettingsResultRow =
		keyword === undefined
			?
				{
					kind: "hit",
					tab,
				}
			:
				{
					kind: "hit",
					tab,
					via: keyword,
				};
	const [first] = entries;
	if (short || (score >= ROW_SCORE_BASE && entries.length === 1))
	{
		if (first === undefined) return [keywordHit];
		show(first);
		return [viaHit(tab, first)];
	}
	// A section found by its alias (upstream `shownSectionName`) names the alias on its via line.
	const hit: SettingsResultRow =
		alias === undefined
			?
				{
					kind: "hit",
					tab,
				}
			:
				{
					kind: "hit",
					tab,
					via: alias,
				};
	if (first === undefined) return [keyword === undefined ? hit : keywordHit];
	const visible = expanded.has(tab) ? entries : entries.slice(0, MAX_CHILDREN);
	for (const entry of visible) show(entry);
	const hidden = entries.length - visible.length;
	return [
		hit,
		...visible.map((entry): SettingsResultRow => (
		{
			kind: "child",
			tab,
			rowSlug: entry.rowSlug,
			title: entry.title,
			...targetOf(entry),
		})),
		...(hidden > 0
			? [
					{
						kind: "more" as const,
						tab,
						count: hidden,
					},
				]
			: []),
	];
}

/**
 * Upstream's Skills → Plugins dedupe: lay out Skills alone, then drop from Plugins every row whose target
 * Skills shows. Plugins, when found only by those rows, drops out.
 */
function withoutSkillsShownInPlugins(
	sections: readonly RankedSettingsSection[],
	short: boolean,
	expanded: ReadonlySet<SettingsSearchSection>,
): readonly RankedSettingsSection[]
{
	const skills = sections.find((section) => section.tab === "customize-skills");
	if (skills === undefined) return sections;
	const shownTargets = new Set(
		layoutSection(skills, short, expanded, new Set()).flatMap((row) =>
			row.kind !== "more" && row.target !== undefined && row.rowSlug !== undefined ? [row.rowSlug] : [],
		),
	);
	return sections.flatMap((section) =>
	{
		if (section.tab !== "customize-plugins") return [section];
		const rows = section.rows.filter((row) => !shownTargets.has(row.entry.rowSlug));
		if (rows.length === 0 && section.score >= ROW_SCORE_BASE && section.score < KEYWORD_SCORE) return [];
		return [
			{
				...section,
				rows,
			},
		];
	});
}

/**
 * Upstream's `gn` over ranked sections. A 1-character query gives one hit per section with its
 * first matching row (or keyword) on a via line. Longer queries give a section-name match, or a
 * section with several matching rows, a hit then up to three children and "+N more" (all children
 * when the section is in `expanded`); a single matching row becomes a via-hit, and a keyword-only
 * match a hit with the keyword as via. A section found by an alias (2+ characters only) is a hit with the
 * alias as via, then its rows as children like a name match. Settings row labels already shown under an
 * earlier section are dropped; Customize rows are always kept, and rows sharing a dedupe key show once.
 */
export function layoutSettingsResultRows(
	sections: readonly RankedSettingsSection[],
	query: string,
	expanded: ReadonlySet<SettingsSearchSection>,
): SettingsResultRow[]
{
	const short = normalizeSettingsQuery(query).length < MIN_CHILD_QUERY_LENGTH;
	const shown = new Set<string>();
	return withoutSkillsShownInPlugins(sections, short, expanded).flatMap((section) =>
		layoutSection(section, short, expanded, shown),
	);
}

/** The popover rows for `query`, with the sections in `expanded` showing every child. */
export function buildSettingsResultRows(
	query: string,
	expanded: ReadonlySet<SettingsSearchSection>,
	customize?: CustomizeSearchIndex,
): SettingsResultRow[]
{
	return layoutSettingsResultRows(rankSettingsSections(query, NAV_SEARCH_NAMES, customize), query, expanded);
}

/** Split `title` into the text before, inside and after a match of `length` at `start`. */
export function splitMatch(
	title: string,
	start: number,
	length: number,
):
{
	before: string;
	match: string;
	after: string;
}
{
	return {
		before: title.slice(0, start),
		match: title.slice(start, start + length),
		after: title.slice(start + length),
	};
}
