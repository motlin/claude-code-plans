import {describe, expect, it} from "vite-plus/test";
import {
	applyPaletteFilters,
	commitPaletteTokens,
	paletteChips,
	popPaletteFilter,
	paletteDateCutoff,
	paletteFilterHintMatch,
	paletteFilterHints,
	paletteInlineSuggestions,
	paletteSearchParams,
	PaletteTypeSchema,
	paletteValueSuggestions,
	parsePaletteTokens,
	resolvePaletteProject,
	nextPaletteType,
	paletteTypeStep,
	scrollIntoStrip,
	type PaletteTokens,
} from "../src/lib/palette-tokens";

describe("PaletteTypeSchema", () => {
	it("orders the tabs like claude.ai/code, with the local types last", () => {
		expect(PaletteTypeSchema.options).toStrictEqual([
			"all",
			"artifacts",
			"sessions",
			"projects",
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
		["/", ["date", "repo", "project", "type", "archived", "actions"]],
		["/a", ["archived", "actions"]],
		["/re", ["date", "repo"]],
		["/to", ["date"]],
		["/we", ["date"]],
		["/mo", ["date"]],
		["/ki", ["type"]],
		["/com", ["actions"]],
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
			{label: "Code", query: "type:code "},
			{label: "Projects", query: "type:projects "},
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

	it("offers no value list for Archived and Actions, whose hints commit at once", () => {
		expect({
			archived: paletteValueSuggestions("archived:", sessions),
			actions: paletteValueSuggestions("actions:", sessions),
		}).toStrictEqual({archived: null, actions: null});
	});

	it("narrows the values to those whose label, or a word of it, starts with the typed text", () => {
		expect({
			p: labels("date:p"),
			week: labels("date:WE"),
			joined: labels("date:pastw"),
			repo: labels("repo:av"),
			project: labels("project:not"),
		}).toStrictEqual({
			p: ["Past week", "Past month"],
			week: ["Past week"],
			joined: ["Past week"],
			repo: ["avalon"],
			project: null,
		});
	});

	it("does not split repo labels on hyphens, like upstream", () => {
		expect(
			paletteValueSuggestions("fix repo:pla", [
				{project: "motlin/playdate-template", projectName: "playdate"},
				{project: "/Users/dev/claude-code-plans", projectName: "ccp"},
			]),
		).toStrictEqual({
			filter: "repo",
			values: [{label: "playdate-template", query: "fix repo:playdate-template "}],
		});
	});

	it("completes a typed prefix, keeping the text before the token", () => {
		expect(paletteValueSuggestions("fix date:p", sessions)?.values).toStrictEqual([
			{label: "Past week", query: "fix date:week "},
			{label: "Past month", query: "fix date:month "},
		]);
	});

	it("is null when no value matches, so the query falls through to search", () => {
		expect(["", "date", "date:zz", "repo:plazz", "date: ", "http:", "/date:"].map(labels)).toStrictEqual([
			null,
			null,
			null,
			null,
			null,
			null,
			null,
		]);
	});
});

describe("paletteFilterHintMatch", () => {
	const ALL = ["date", "repo", "project", "type", "archived", "actions"];

	it.each([
		["/", {keys: ALL, start: 0, sentence: true}],
		["/re", {keys: ["date", "repo"], start: 0, sentence: true}],
		["filter by re", {keys: ["date", "repo"], start: 0, sentence: true}],
		["fix filt", {keys: ALL, start: 4, sentence: true}],
		["filte", {keys: ALL, start: 0, sentence: true}],
		["Filters", {keys: ALL, start: 0, sentence: true}],
		["filter b", {keys: ALL, start: 0, sentence: true}],
		["filter by ", {keys: ALL, start: 0, sentence: true}],
		["filter by a", {keys: ["archived", "actions"], start: 0, sentence: true}],
		["rep", {keys: ["repo"], start: 0, sentence: false}],
		["fix today", {keys: ["date"], start: 4, sentence: false}],
		["com", {keys: ["actions"], start: 0, sentence: false}],
	])("matches %j", (query, expected) => {
		expect(paletteFilterHintMatch(query)).toStrictEqual(expected);
	});

	it.each(["ab", "", "/zz", "filter by zz", "zzz", "fix ", "rep ", "repo:", "filtering", "prefilter"])(
		"is undefined for %j",
		(query) => {
			expect(paletteFilterHintMatch(query)).toBeUndefined();
		},
	);
});

describe("paletteInlineSuggestions", () => {
	const sessions = [
		{project: "/Users/dev/claude-code-plans", projectName: "ccp"},
		{project: "/Users/dev/avalon", projectName: "avalon"},
	];

	it("suggests the value the last words name, with where its words start", () => {
		expect(paletteInlineSuggestions("sync this week", sessions)).toStrictEqual([
			{filter: "date", value: "week", label: "Date: Past week", start: 10},
		]);
	});

	it("matches up to four trailing words against the label without spaces", () => {
		expect(paletteInlineSuggestions("fix past mo", sessions)).toStrictEqual([
			{filter: "date", value: "month", label: "Date: Past month", start: 4},
		]);
	});

	it("suggests repos, projects and types too", () => {
		expect({
			repo: paletteInlineSuggestions("fix ava", sessions),
			type: paletteInlineSuggestions("my plans", sessions),
		}).toStrictEqual({
			repo: [
				{filter: "repo", value: "avalon", label: "Repo: avalon", start: 4},
				{filter: "project", value: "avalon", label: "Project: avalon", start: 4},
			],
			type: [{filter: "type", value: "plans", label: "Type: Plans", start: 3}],
		});
	});

	it("matches only words of two or more letters, never a token or nothing", () => {
		expect(
			["sy", "fix p", "", "fix ", "date:week", "sync zzz"].map((query) =>
				paletteInlineSuggestions(query, sessions),
			),
		).toStrictEqual([[], [], [], [], [], []]);
	});
});

describe("commitPaletteTokens", () => {
	const sessions = [
		{project: "/Users/dev/ccp", projectName: "claude-code-plans"},
		{project: "/Users/dev/avalon", projectName: "avalon"},
	];

	it("commits every key:value word followed by whitespace and strips it from the text", () => {
		expect(commitPaletteTokens("date:month archived: hello", {}, sessions)).toStrictEqual({
			text: "hello",
			filters: {date: "month", archived: true},
		});
	});

	it("switches the tab for type: instead of committing a chip", () => {
		expect(commitPaletteTokens("fix type:code ", {}, sessions)).toStrictEqual({
			text: "fix ",
			filters: {},
			tab: "sessions",
		});
	});

	it("leaves unknown values, unfinished tokens and bare value keys as text", () => {
		expect(
			["repo:nope ", "date:t", "date:soon ", "date: ", "type:nope ", "http://x.y "].map((query) =>
				commitPaletteTokens(query, {}, sessions),
			),
		).toStrictEqual([
			{text: "repo:nope ", filters: {}},
			{text: "date:t", filters: {}},
			{text: "date:soon ", filters: {}},
			{text: "date: ", filters: {}},
			{text: "type:nope ", filters: {}},
			{text: "http://x.y ", filters: {}},
		]);
	});

	it("commits known repos and projects with their canonical spelling", () => {
		expect(commitPaletteTokens("repository:CCP project:Avalon fix", {}, sessions)).toStrictEqual({
			text: "fix",
			filters: {repo: "ccp", project: "avalon"},
		});
	});

	it("accepts upstream's flag spellings and date aliases", () => {
		expect(commitPaletteTokens("is:archived when:today ", {}, sessions)).toStrictEqual({
			text: "",
			filters: {archived: true, date: "today"},
		});
	});

	it("keeps existing filters and lets a later token replace one", () => {
		expect(commitPaletteTokens("date:today x", {date: "week", repo: "ccp"}, sessions)).toStrictEqual({
			text: "x",
			filters: {date: "today", repo: "ccp"},
		});
	});

	it("makes Actions mode exclusive", () => {
		expect({
			actionsClears: commitPaletteTokens("actions: ", {date: "week"}, sessions),
			otherClearsActions: commitPaletteTokens("date:week ", {actions: true}, sessions),
		}).toStrictEqual({
			actionsClears: {text: "", filters: {actions: true}},
			otherClearsActions: {text: "", filters: {date: "week"}},
		});
	});
});

describe("popPaletteFilter", () => {
	it("pops actions, archived, project, repo, then date", () => {
		const steps: unknown[] = [];
		let state: ReturnType<typeof popPaletteFilter> = {
			filters: {actions: true, archived: true, project: "avalon", repo: "ccp", date: "week"},
			tab: "all",
		};
		while (state !== null) {
			state = popPaletteFilter(state.filters, state.tab);
			steps.push(state);
		}
		expect(steps).toStrictEqual([
			{filters: {archived: true, project: "avalon", repo: "ccp", date: "week"}, tab: "all"},
			{filters: {project: "avalon", repo: "ccp", date: "week"}, tab: "all"},
			{filters: {repo: "ccp", date: "week"}, tab: "all"},
			{filters: {date: "week"}, tab: "all"},
			{filters: {}, tab: "all"},
			null,
		]);
	});

	it("returns to All once no filters remain on another tab", () => {
		expect(popPaletteFilter({}, "sessions")).toStrictEqual({filters: {}, tab: "all"});
	});
});

describe("applyPaletteFilters", () => {
	it("keeps the typed tokens when no chips are committed", () => {
		expect(applyPaletteFilters({text: "fix", date: "today"}, {})).toStrictEqual({text: "fix", date: "today"});
	});

	it("narrows by the committed chips, a repo chip naming the project", () => {
		expect(applyPaletteFilters({text: "fix"}, {date: "week", repo: "ccp", archived: true})).toStrictEqual({
			text: "fix",
			date: "week",
			project: "ccp",
			archived: true,
		});
	});

	it("lets a project chip win over a typed project token, and carries actions mode", () => {
		expect(applyPaletteFilters({text: "", project: "typed"}, {project: "avalon", actions: true})).toStrictEqual({
			text: "",
			project: "avalon",
			actions: true,
		});
	});
});

describe("paletteChips", () => {
	it("orders chips like upstream and names all but Archived and Actions", () => {
		expect(
			paletteChips({archived: true, project: "avalon", repo: "acme/app", date: "today"}, [
				"acme/app",
				"other/lib",
			]),
		).toStrictEqual([
			{filter: "date", label: "Date Today", title: "Today", text: "Today"},
			{filter: "repo", label: "Repo acme/app", title: "acme/app", text: "app"},
			{filter: "project", label: "Project avalon", title: "avalon", text: "avalon"},
			{filter: "archived", label: "Archived", title: "Archived", text: "Archived"},
		]);
	});

	it("keeps the full repo when the name after the last slash is not unique", () => {
		expect(paletteChips({repo: "acme/app"}, ["acme/app", "other/app"])).toStrictEqual([
			{filter: "repo", label: "Repo acme/app", title: "acme/app", text: "acme/app"},
		]);
	});

	it("shows the lone Actions chip in actions mode", () => {
		expect(paletteChips({actions: true}, [])).toStrictEqual([
			{filter: "actions", label: "Actions", title: "Actions", text: "Actions"},
		]);
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

describe("scrollIntoStrip", () => {
	function strip(scrollLeft: number) {
		return {
			scrollLeft,
			getBoundingClientRect: () => ({left: 0, right: 390}),
			paddingLeft: "24px",
		};
	}
	const tab = (left: number, right: number) => ({getBoundingClientRect: () => ({left, right})});
	const run = (scrollLeft: number, left: number, right: number) => {
		const element = strip(scrollLeft);
		scrollIntoStrip(element, tab(left, right), element.paddingLeft);
		return element.scrollLeft;
	};

	it("scrolls by the overflow past the padded edges, and not at all when the tab already fits", () => {
		expect({
			pastEnd: run(0, 600, 650),
			pastStart: run(300, 10, 60),
			inside: run(50, 100, 200),
		}).toStrictEqual({pastEnd: 284, pastStart: 286, inside: 50});
	});
});

describe("paletteTypeStep", () => {
	const key = (overrides: Partial<Parameters<typeof paletteTypeStep>[0]> = {}) => ({
		key: "ArrowRight",
		shiftKey: false,
		altKey: false,
		metaKey: false,
		ctrlKey: false,
		repeat: false,
		composing: false,
		...overrides,
	});
	const field = (text: string, selectionStart = text.length, selectionEnd = selectionStart) => ({
		text,
		selectionStart,
		selectionEnd,
	});

	it.each([
		["Shift held", key({shiftKey: true}), field(""), false, 0],
		["Alt held", key({altKey: true}), field(""), false, 0],
		["Meta held", key({metaKey: true}), field(""), false, 0],
		["Ctrl held", key({ctrlKey: true}), field(""), false, 0],
		["IME composition", key({composing: true}), field(""), false, 0],
		["a key other than an arrow", key({key: "ArrowDown"}), field(""), false, 0],
		["a non-collapsed selection", key(), field("do", 0, 2), false, 0],
		["the caret mid-text", key(), field("do", 1), false, 0],
		["a repeat with text", key({repeat: true}), field("do"), false, 0],
		["a repeat with an empty query", key({repeat: true}), field(""), false, 1],
		["→ with an empty query", key(), field(""), false, 1],
		["← with an empty query", key({key: "ArrowLeft"}), field(""), false, -1],
		["→ with the caret at the end", key(), field("do", 2), false, 1],
		["← with the caret at the end", key({key: "ArrowLeft"}), field("do", 2), false, 0],
		["← with the caret at the start", key({key: "ArrowLeft"}), field("do", 0), false, -1],
		["→ in RTL", key(), field(""), true, -1],
		["← in RTL", key({key: "ArrowLeft"}), field(""), true, 1],
		["Hebrew text in an LTR UI", key(), field("שלום"), false, 0],
		["Latin text in an RTL UI", key(), field("do", 0), true, 0],
		["Hebrew text in an RTL UI", key(), field("שלום", 0), true, -1],
		["digits and spaces in an LTR UI", key(), field("12 3"), false, 1],
	] as const)("%s → %d", (_name, event, input, rtl, expected) => {
		expect(paletteTypeStep(event, input, rtl)).toBe(expected);
	});
});

describe("nextPaletteType", () => {
	const types = PaletteTypeSchema.options;

	it.each([
		["Files + 1 with wrap", "files", 1, true, "all"],
		["Files + 1 without wrap", "files", 1, false, undefined],
		["All − 1 with wrap", "all", -1, true, "files"],
		["All − 1 without wrap", "all", -1, false, undefined],
		["Scheduled + 1 without wrap", "scheduled", 1, false, "plans"],
		["Artifacts − 1 without wrap", "artifacts", -1, false, "all"],
	] as const)("%s", (_name, current, dir, wrap, expected) => {
		expect(nextPaletteType(types, current, dir, wrap)).toBe(expected);
	});

	it("starts from the first entry when the current one is missing, and gives undefined when that is a no-op", () => {
		expect({
			missing: nextPaletteType(["a", "b"], "z", 1, true),
			single: nextPaletteType(["a"], "a", 1, true),
		}).toStrictEqual({missing: "a", single: undefined});
	});
});
