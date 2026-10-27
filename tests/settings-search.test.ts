import {describe, expect, it} from "vite-plus/test";
import {
	buildSettingsResultRows,
	layoutSettingsResultRows,
	normalizeSettingsQuery,
	rankSettingsLabel,
	rankSettingsSections,
	SETTINGS_INDEX,
	SETTINGS_SECTION_KEYWORDS,
	settingsMatchStart,
	splitMatch,
} from "../src/lib/settings-search";

describe("SETTINGS_INDEX", () => {
	it("has one entry per tab and row slug", () => {
		const keys = SETTINGS_INDEX.map((entry) => `${entry.tab}/${entry.rowSlug}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("rankSettingsSections grouping", () => {
	it.each<[string, Array<{tab: string; rows: Array<[string, string]>}>]>([
		["", []],
		["   ", []],
		["zzz-no-such-setting", []],
		// Claude Code scores 5 + 2 (word start); General scores 5 + 4 via the "font size" phrase.
		[
			"font",
			[
				{
					tab: "claude-code",
					rows: [
						["code-font", "Code font"],
						["interface-font", "Interface font"],
					],
				},
				{tab: "general", rows: [["transcript-text-size", "Transcript text size"]]},
			],
		],
		// Space-insensitive prefix and order-free word starts.
		["codefont", [{tab: "claude-code", rows: [["code-font", "Code font"]]}]],
		["font code", [{tab: "claude-code", rows: [["code-font", "Code font"]]}]],
		["font size", [{tab: "general", rows: [["transcript-text-size", "Transcript text size"]]}]],
		["dark mode", [{tab: "general", rows: [["theme", "Theme"]]}]],
		// A keyword-only section hit has no rows.
		["tmux", [{tab: "application", rows: []}]],
		// A section-name match outranks row matches elsewhere.
		["sessions", [{tab: "sessions", rows: [["sessions-page-grouping", "Sessions page grouping"]]}]],
		// Case-insensitive, and title-only: section headings ("Code appearance") are not indexed.
		["THEME", [{tab: "general", rows: [["theme", "Theme"]]}]],
		["appearance", []],
		["width", [{tab: "general", rows: [["transcript-width", "Transcript width"]]}]],
		// Title prefix matches outrank word-start matches, which outrank mid-word matches,
		// and groups follow their best-ranked row.
		[
			"hook",
			[
				{
					tab: "transcript",
					rows: [
						["hook-warnings", "Hook warnings"],
						["hook-errors", "Hook errors"],
						["passed-hooks", "Passed hooks"],
					],
				},
			],
		],
		[
			"view",
			[
				{
					tab: "claude-code",
					rows: [["default-transcript-view", "Default transcript view"]],
				},
				{
					tab: "sessions",
					rows: [
						["default-view", "Default view"],
						["offer-to-review-uncommitted-changes", "Offer to review uncommitted changes"],
					],
				},
				{
					tab: "ai-features",
					rows: [
						["working-copy-review", "Working-copy review"],
						["review-behavior", "Review behavior"],
					],
				},
			],
		],
		[
			"ink",
			[
				{
					tab: "transcript",
					rows: [["thinking", "Thinking"]],
				},
			],
		],
	])("groups results for %j", (query, expected) => {
		const actual = rankSettingsSections(query).map((section) => ({
			tab: section.tab,
			rows: section.rows.map(({entry}) => [entry.rowSlug, entry.title]),
		}));
		expect(actual).toStrictEqual(expected);
	});
});

describe("settingsMatchStart", () => {
	it.each<[string, string, number]>([
		["Code font", "FONT", 5],
		["Interface font", " font ", 10],
		// A word-start occurrence beats an earlier mid-word one.
		["Offer to review uncommitted changes", "re", 9],
		["Thinking", "ink", 2],
		// Phrase, collapsed-space and out-of-order hits have no literal match.
		["Transcript text size", "font size", -1],
		["Code font", "codefont", -1],
		["Code font", "font code", -1],
	])("locates %j in %j at %d", (label, query, expected) => {
		expect(settingsMatchStart(label, query)).toBe(expected);
	});
});

describe("normalizeSettingsQuery", () => {
	it.each<[string, string]>([
		["Ünïcode–Font_size", "unicode font size"],
		["  Code   FONT ", "code font"],
		["working-copy__review", "working copy review"],
		["\u2018it\u2019s\u201b \u201cquoted\u201d", "'it's' \"quoted\""],
		["café", "cafe"],
		["", ""],
	])("normalizes %j to %j", (query, expected) => {
		expect(normalizeSettingsQuery(query)).toBe(expected);
	});
});

describe("rankSettingsLabel", () => {
	it.each<[string, string, number]>([
		["code font", "Code font", 0],
		["codefont", "Code font", 0],
		["code", "Code font", 1],
		["codef", "Code font", 1],
		["font code", "Code font", 2],
		["font", "Code font", 2],
		["textsize", "Transcript text size", 2],
		["ont", "Code font", 3],
		["ont cod", "Code font", 3],
		["size font", "Transcript text size", -1],
		["zzz", "Code font", -1],
		["", "Code font", -1],
	])("ranks %j against %j as %d", (query, label, expected) => {
		expect(rankSettingsLabel(query, label)).toBe(expected);
	});
});

describe("SETTINGS_SECTION_KEYWORDS", () => {
	it("matches the local keyword map", () => {
		expect(SETTINGS_SECTION_KEYWORDS).toStrictEqual({
			usage: ["overage", "extra usage", "spend limit", "usage credits"],
			"claude-config": ["settings.json"],
			application: ["herdr", "tmux"],
		});
	});
});

describe("rankSettingsSections", () => {
	it.each<[string, Array<{tab: string; score: number; keyword?: string; rows: Array<[string, number]>}>]>([
		["", []],
		["zzzq", []],
		// Name rank 0-3 wins outright.
		["general", [{tab: "general", score: 0, rows: []}]],
		[
			"code",
			[
				{tab: "claude-code", score: 2, rows: [["code-font", 1]]},
				{tab: "general", score: 6, rows: [["code-permission-requests", 1]]},
				{tab: "claude-config", score: 7, rows: [["claude-code-settings-files", 2]]},
			],
		],
		// 5 + best row rank; phrases score 4.
		[
			"mode",
			[
				{tab: "claude-code", score: 7, rows: [["allow-bypass-permissions-mode", 2]]},
				{tab: "general", score: 9, rows: [["theme", 4]]},
			],
		],
	])("scores sections for %j", (query, expected) => {
		const actual = rankSettingsSections(query).map((section) => ({
			tab: section.tab,
			score: section.score,
			...(section.keyword === undefined ? {} : {keyword: section.keyword}),
			rows: section.rows.map((row) => [row.entry.rowSlug, row.rank]),
		}));
		expect(actual).toStrictEqual(expected);
	});

	it("scores a keyword-only hit 10 and reports the keyword", () => {
		expect(
			rankSettingsSections("overage").map((section) => ({
				tab: section.tab,
				score: section.score,
				keyword: section.keyword,
				rows: section.rows,
			})),
		).toStrictEqual([{tab: "usage", score: 10, keyword: "overage", rows: []}]);
	});
});

describe("splitMatch", () => {
	it("splits a title around the matched range", () => {
		expect(splitMatch("Interface font", 10, 4)).toStrictEqual({
			before: "Interface ",
			match: "font",
			after: "",
		});
	});
});

describe("buildSettingsResultRows", () => {
	it.each<[string, ReturnType<typeof buildSettingsResultRows>]>([
		["", []],
		["zzzq", []],
		// Several row matches: a hit, then its children. A single row match is one via-hit.
		[
			"font",
			[
				{kind: "hit", tab: "claude-code"},
				{kind: "child", tab: "claude-code", rowSlug: "code-font", title: "Code font"},
				{kind: "child", tab: "claude-code", rowSlug: "interface-font", title: "Interface font"},
				{kind: "hit", tab: "general", via: "Transcript text size", rowSlug: "transcript-text-size"},
			],
		],
		["theme", [{kind: "hit", tab: "general", via: "Theme", rowSlug: "theme"}]],
		// A section-name match lists its matching rows as children even when there is one.
		[
			"transcript",
			[
				{kind: "hit", tab: "transcript"},
				{
					kind: "child",
					tab: "transcript",
					rowSlug: "show-transcript-only-system-records",
					title: "Show transcript-only system records",
				},
				{kind: "hit", tab: "general"},
				{kind: "child", tab: "general", rowSlug: "transcript-text-size", title: "Transcript text size"},
				{kind: "child", tab: "general", rowSlug: "transcript-width", title: "Transcript width"},
				{
					kind: "hit",
					tab: "claude-code",
					via: "Default transcript view",
					rowSlug: "default-transcript-view",
				},
			],
		],
		// A section-name match with no matching rows is a bare hit.
		["general", [{kind: "hit", tab: "general"}]],
		// A keyword-only hit shows the keyword on its via line and has no row.
		["tmux", [{kind: "hit", tab: "application", via: "tmux"}]],
		// More than three matches: three children, then "+N more".
		[
			"hook",
			[
				{kind: "hit", tab: "transcript"},
				{kind: "child", tab: "transcript", rowSlug: "hook-warnings", title: "Hook warnings"},
				{kind: "child", tab: "transcript", rowSlug: "hook-errors", title: "Hook errors"},
				{kind: "child", tab: "transcript", rowSlug: "passed-hooks", title: "Passed hooks"},
			],
		],
		// One character: one hit per section, each with its best row on a via line; name-only
		// sections (Setup, Usage) are bare hits. Ties keep nav order.
		[
			"s",
			[
				{kind: "hit", tab: "sessions", via: "Sessions page grouping", rowSlug: "sessions-page-grouping"},
				{kind: "hit", tab: "setup"},
				{kind: "hit", tab: "usage"},
				{kind: "hit", tab: "transcript", via: "System banners", rowSlug: "system-banners"},
				{kind: "hit", tab: "ai-features", via: "Summary button", rowSlug: "summary-button"},
				{kind: "hit", tab: "application", via: "Shell tabs", rowSlug: "shell-tabs"},
				{kind: "hit", tab: "general", via: "Transcript text size", rowSlug: "transcript-text-size"},
				{kind: "hit", tab: "claude-code", via: "Local sandbox", rowSlug: "local-sandbox"},
				{
					kind: "hit",
					tab: "claude-config",
					via: "Claude Code settings files",
					rowSlug: "claude-code-settings-files",
				},
			],
		],
	])("lays out rows for %j", (query, expected) => {
		expect(buildSettingsResultRows(query, new Set())).toStrictEqual(expected);
	});

	it("caps a section at three children and counts the rest in a more row, unless expanded", () => {
		const entries = ["Alpha one", "Alpha two", "Alpha three", "Alpha four", "Alpha five"].map((title, index) => ({
			entry: {tab: "general" as const, rowSlug: `row-${index}`, title},
			rank: 1,
		}));
		const sections = [{tab: "general" as const, score: 6, rows: entries}];

		expect(layoutSettingsResultRows(sections, "alpha", new Set())).toStrictEqual([
			{kind: "hit", tab: "general"},
			{kind: "child", tab: "general", rowSlug: "row-0", title: "Alpha one"},
			{kind: "child", tab: "general", rowSlug: "row-1", title: "Alpha two"},
			{kind: "child", tab: "general", rowSlug: "row-2", title: "Alpha three"},
			{kind: "more", tab: "general", count: 2},
		]);
		expect(layoutSettingsResultRows(sections, "alpha", new Set(["general"]))).toStrictEqual([
			{kind: "hit", tab: "general"},
			{kind: "child", tab: "general", rowSlug: "row-0", title: "Alpha one"},
			{kind: "child", tab: "general", rowSlug: "row-1", title: "Alpha two"},
			{kind: "child", tab: "general", rowSlug: "row-2", title: "Alpha three"},
			{kind: "child", tab: "general", rowSlug: "row-3", title: "Alpha four"},
			{kind: "child", tab: "general", rowSlug: "row-4", title: "Alpha five"},
		]);
	});

	it("drops a row label already shown under an earlier section", () => {
		const sections = [
			{
				tab: "general" as const,
				score: 6,
				rows: [
					{entry: {tab: "general" as const, rowSlug: "a", title: "Shared"}, rank: 1},
					{entry: {tab: "general" as const, rowSlug: "b", title: "Shared two"}, rank: 1},
				],
			},
			{
				tab: "sessions" as const,
				score: 6,
				rows: [
					{entry: {tab: "sessions" as const, rowSlug: "c", title: "Shared"}, rank: 1},
					{entry: {tab: "sessions" as const, rowSlug: "d", title: "Shared three"}, rank: 1},
				],
			},
		];

		expect(layoutSettingsResultRows(sections, "shared", new Set())).toStrictEqual([
			{kind: "hit", tab: "general"},
			{kind: "child", tab: "general", rowSlug: "a", title: "Shared"},
			{kind: "child", tab: "general", rowSlug: "b", title: "Shared two"},
			{kind: "hit", tab: "sessions", via: "Shared three", rowSlug: "d"},
		]);
	});
});
