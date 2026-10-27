import {describe, expect, it} from "vite-plus/test";
import {
	normalizeSettingsQuery,
	rankSettingsLabel,
	rankSettingsSections,
	searchSettings,
	SETTINGS_INDEX,
	SETTINGS_SECTION_KEYWORDS,
	splitMatch,
} from "../src/lib/settings-search";

describe("SETTINGS_INDEX", () => {
	it("has one entry per tab and row slug", () => {
		const keys = SETTINGS_INDEX.map((entry) => `${entry.tab}/${entry.rowSlug}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("searchSettings", () => {
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
		const actual = searchSettings(query).map((group) => ({
			tab: group.tab,
			rows: group.results.map((result) => [result.rowSlug, result.title]),
		}));
		expect(actual).toStrictEqual(expected);
	});

	it("reports where the query matched in the title, and no match for phrase hits", () => {
		expect(searchSettings("FONT")).toStrictEqual([
			{
				tab: "claude-code",
				results: [
					{tab: "claude-code", rowSlug: "code-font", title: "Code font", start: 5},
					{tab: "claude-code", rowSlug: "interface-font", title: "Interface font", start: 10},
				],
			},
			{
				tab: "general",
				results: [
					{
						tab: "general",
						rowSlug: "transcript-text-size",
						title: "Transcript text size",
						searchPhrases: ["font size"],
						start: -1,
					},
				],
			},
		]);
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
		["mode", [{tab: "general", score: 9, rows: [["theme", 4]]}]],
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
