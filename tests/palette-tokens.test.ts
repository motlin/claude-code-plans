import {describe, expect, it} from "vite-plus/test";
import {
	paletteDateCutoff,
	paletteFilterHints,
	paletteSearchParams,
	PaletteTypeSchema,
	parsePaletteTokens,
	resolvePaletteProject,
	withoutTypeTokens,
	type PaletteTokens,
} from "../src/lib/palette-tokens";

describe("PaletteTypeSchema", () => {
	it("orders the tabs like claude.ai/code, with the local types last", () => {
		expect(PaletteTypeSchema.options).toStrictEqual([
			"all",
			"artifacts",
			"projects",
			"sessions",
			"scheduled",
			"plans",
			"memories",
			"files",
		]);
	});
});

describe("parsePaletteTokens", () => {
	const cases: ReadonlyArray<readonly [string, PaletteTokens]> = [
		["", {text: ""}],
		["auth module", {text: "auth module"}],
		["  auth   module  ", {text: "auth module"}],
		["repo:ccp auth", {text: "auth", project: "ccp"}],
		["repository:ccp", {text: "", project: "ccp"}],
		["project:-users-dev-ccp fix", {text: "fix", project: "-users-dev-ccp"}],
		["Repo:CCP", {text: "", project: "CCP"}],
		["date:today build", {text: "build", date: "today"}],
		["when:week", {text: "", date: "week"}],
		["active:MONTH", {text: "", date: "month"}],
		["date:yesterday", {text: "date:yesterday"}],
		["type:session", {text: "", type: "sessions"}],
		["type:plans x", {text: "x", type: "plans"}],
		["type:memory", {text: "", type: "memories"}],
		["type:file", {text: "", type: "files"}],
		["type:project", {text: "", type: "projects"}],
		["type:artifact", {text: "", type: "artifacts"}],
		["type:artifacts", {text: "", type: "artifacts"}],
		["type:scheduled", {text: "", type: "scheduled"}],
		["type:routine", {text: "", type: "scheduled"}],
		["type:chat", {text: "type:chat"}],
		["is:archived old", {text: "old", archived: true}],
		["is:starred", {text: "is:starred"}],
		["repo: auth", {text: "auth"}],
		["repo:a repo:b", {text: "", project: "b"}],
		["http://localhost", {text: "http://localhost"}],
		["fix repo:ccp date:week type:sessions bug", {text: "fix bug", project: "ccp", date: "week", type: "sessions"}],
	];

	it.each(cases)("parses %j", (query, expected) => {
		expect(parsePaletteTokens(query)).toStrictEqual(expected);
	});
});

describe("resolvePaletteProject", () => {
	const projects = [
		{
			id: "-Users-dev-claude-code-plans",
			name: "claude-code-plans",
			projectPath: "/Users/dev/ccp",
		},
		{id: "-Users-dev-other", name: "other", projectPath: null},
	];

	it.each([
		["-Users-dev-other", "-Users-dev-other"],
		["claude-code-plans", "-Users-dev-claude-code-plans"],
		["Claude-Code-Plans", "-Users-dev-claude-code-plans"],
		["ccp", "-Users-dev-claude-code-plans"],
		["OTHER", "-Users-dev-other"],
		["missing", "missing"],
	])("resolves %j to %j", (value, expected) => {
		expect(resolvePaletteProject(value, projects)).toBe(expected);
	});
});

describe("paletteSearchParams", () => {
	it("maps tokens onto /api/search params", () => {
		expect(
			paletteSearchParams({text: "fix", project: "ccp", date: "week", type: "plans"}, "all", [
				{id: "-Users-dev-ccp", name: "claude-code-plans", projectPath: "/Users/dev/ccp"},
			]),
		).toStrictEqual({query: "fix", type: "plans", project: "-Users-dev-ccp", date: "week"});
	});

	it("falls back to the tab when there is no type token", () => {
		expect(paletteSearchParams({text: "fix"}, "memories", [])).toStrictEqual({
			query: "fix",
			type: "memories",
		});
	});

	it("has no server params for the Projects type", () => {
		expect(paletteSearchParams({text: "fix"}, "projects", [])).toBeNull();
	});

	it("has no server params for the Artifacts and Scheduled types", () => {
		expect([
			paletteSearchParams({text: "fix"}, "artifacts", []),
			paletteSearchParams({text: "fix"}, "scheduled", []),
			paletteSearchParams({text: "fix", type: "artifacts"}, "all", []),
		]).toStrictEqual([null, null, null]);
	});
});

describe("paletteFilterHints", () => {
	it.each([
		["/", ["project", "date", "repo", "type"]],
		["/re", ["date", "repo"]],
		["/TY", ["type"]],
		["/zz", []],
	])("hints for %j", (query, expected) => {
		expect(paletteFilterHints(query)).toStrictEqual(expected);
	});

	it("is not in hint mode without a leading slash or with spaces", () => {
		expect({
			plain: paletteFilterHints("re"),
			spaced: paletteFilterHints("/re x"),
		}).toStrictEqual({plain: null, spaced: null});
	});
});

describe("withoutTypeTokens", () => {
	it("strips every type: token and keeps the rest", () => {
		expect(withoutTypeTokens("fix type:plans repo:ccp Type:files")).toBe("fix repo:ccp");
	});
});

describe("paletteDateCutoff", () => {
	const now = new Date(2026, 8, 29, 15, 30).getTime();

	it.each([
		["today", new Date(2026, 8, 29).getTime()],
		["week", now - 7 * 24 * 60 * 60_000],
		["month", now - 30 * 24 * 60 * 60_000],
	] as const)("cuts %s off at the right instant", (date, expected) => {
		expect(paletteDateCutoff(date, now)).toBe(expected);
	});
});
