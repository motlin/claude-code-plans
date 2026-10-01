import {describe, expect, it} from "vite-plus/test";
import {
	paletteDateCutoff,
	paletteFilterHints,
	paletteSearchParams,
	PaletteTypeSchema,
	paletteValueSuggestions,
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
		["archived:", {text: "", archived: true}],
		["archived:true old", {text: "old", archived: true}],
		["archived:nope", {text: "archived:nope"}],
		["actions:", {text: "", actions: true}],
		["Actions:TRUE sett", {text: "sett", actions: true}],
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
		["/", ["project", "date", "repo", "type", "archived", "actions"]],
		["/re", ["date", "repo"]],
		["/a", ["date", "archived", "actions"]],
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

describe("paletteValueSuggestions", () => {
	const sessions = [
		{project: "/Users/dev/ccp", projectName: "claude-code-plans"},
		{project: "/Users/dev/avalon", projectName: "avalon"},
		{project: "/Users/dev/ccp", projectName: "claude-code-plans"},
		{project: "/Users/dev/my notes", projectName: "my notes"},
		...Array.from({length: 12}, (_, index) => ({project: `/Users/dev/r${index}`, projectName: `p${index}`})),
	];

	function labels(query: string): string[] | null {
		return paletteValueSuggestions(query, sessions)?.values.map((value) => value.label) ?? null;
	}

	it("offers the Date values after a bare date: key", () => {
		expect(paletteValueSuggestions("date:", sessions)).toStrictEqual({
			filter: "date",
			values: [
				{label: "Today", query: "date:today "},
				{label: "Past week", query: "date:week "},
				{label: "Past month", query: "date:month "},
			],
		});
	});

	it("keeps the typed text and alias when completing", () => {
		expect(paletteValueSuggestions("fix when:", sessions)?.values[0]).toStrictEqual({
			label: "Today",
			query: "fix when:today ",
		});
	});

	it("lists the palette types after type:", () => {
		expect(paletteValueSuggestions("type:", sessions)?.values).toStrictEqual([
			{label: "Artifacts", query: "type:artifacts "},
			{label: "Projects", query: "type:projects "},
			{label: "Sessions", query: "type:sessions "},
			{label: "Scheduled", query: "type:scheduled "},
			{label: "Plans", query: "type:plans "},
			{label: "Memories", query: "type:memories "},
			{label: "Files", query: "type:files "},
		]);
	});

	it("lists the ten most recent repos and projects, deduplicated, skipping values with spaces", () => {
		expect({
			repo: labels("repo:"),
			project: paletteValueSuggestions("project:", sessions)?.values.slice(0, 3),
		}).toStrictEqual({
			repo: ["ccp", "avalon", "r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"],
			project: [
				{label: "claude-code-plans", query: "project:claude-code-plans "},
				{label: "avalon", query: "project:avalon "},
				{label: "p0", query: "project:p0 "},
			],
		});
	});

	it("offers a single row for Archived and Actions", () => {
		expect({
			archived: paletteValueSuggestions("archived:", sessions),
			actions: paletteValueSuggestions("actions:", sessions),
		}).toStrictEqual({
			archived: {filter: "archived", values: [{label: "Archived", query: "archived:true "}]},
			actions: {filter: "actions", values: [{label: "Actions", query: "actions:true "}]},
		});
	});

	it("is null unless the query ends in a bare filter key", () => {
		expect(["", "date", "date:t", "date: ", "http:", "/date:"].map(labels)).toStrictEqual([
			null,
			null,
			null,
			null,
			null,
			null,
		]);
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
