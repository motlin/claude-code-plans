import {describe, expect, it} from "vite-plus/test";
import {searchSettings, SETTINGS_INDEX, splitMatch} from "../src/lib/settings-search";

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
			],
		],
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
					rows: [["default-view", "Default view"]],
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

	it("reports where the query matched in the title", () => {
		expect(searchSettings("FONT")).toStrictEqual([
			{
				tab: "claude-code",
				results: [
					{tab: "claude-code", rowSlug: "code-font", title: "Code font", start: 5},
					{tab: "claude-code", rowSlug: "interface-font", title: "Interface font", start: 10},
				],
			},
		]);
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
