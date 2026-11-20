import {describe, expect, it} from "vite-plus/test";
import
{
	buildSettingsResultRows,
	layoutSettingsResultRows,
	normalizeSettingsQuery,
	rankSettingsLabel,
	rankSettingsSections,
	SETTINGS_INDEX,
	SETTINGS_SECTION_KEYWORDS,
	type SettingsSearchSection,
	settingsMatchStart,
	splitMatch,
} from "../src/lib/settings-search";
import {buildCustomizeIndex} from "../src/lib/settings-search-customize";

describe("SETTINGS_INDEX", () =>
{
	it("has one entry per tab and row slug", () =>
	{
		const keys = SETTINGS_INDEX.map((entry) => `${entry.tab}/${entry.rowSlug}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("rankSettingsSections grouping", () =>
{
	it.each<
		[
			string,
			Array<
			{
				tab: string;
				rows: Array<[string, string]>;
			}>,
		]
	>([
		["", []],
		["   ", []],
		["zzz-no-such-setting", []],
		// Both score 5 + 2 (word start) and tie in nav order; General also matches via the "font size" phrase.
		[
			"font",
			[
				{
					tab: "general",
					rows: [
						["interface-font", "Interface font"],
						["response-font", "Response font"],
						["code-font", "Code font"],
						["code-font-size", "Code font size"],
						["transcript-text-size", "Transcript text size"],
					],
				},
			],
		],
		// Space-insensitive prefix and order-free word starts.
		[
			"codefont",
			[
				{
					tab: "general",
					rows: [
						["code-font", "Code font"],
						["code-font-size", "Code font size"],
					],
				},
			],
		],
		[
			"font code",
			[
				{
					tab: "general",
					rows: [
						["code-font", "Code font"],
						["code-font-size", "Code font size"],
					],
				},
			],
		],
		[
			"font size",
			[
				{
					tab: "general",
					rows: [
						["code-font-size", "Code font size"],
						["transcript-text-size", "Transcript text size"],
					],
				},
			],
		],
		[
			"dark mode",
			[
				{
					tab: "general",
					rows: [["theme", "Theme"]],
				},
			],
		],
		// Upstream's Code font size search phrases.
		[
			"editor font size",
			[
				{
					tab: "general",
					rows: [["code-font-size", "Code font size"]],
				},
			],
		],
		[
			"terminal font size",
			[
				{
					tab: "general",
					rows: [["code-font-size", "Code font size"]],
				},
			],
		],
		[
			"terse",
			[
				{
					tab: "claude-code",
					rows: [["output-style", "Output style"]],
				},
			],
		],
		// Upstream's strict-sandbox-mode def is searchable (localSessionRow) with no extra phrases.
		[
			"strict",
			[
				{
					tab: "claude-code",
					rows: [["strict-sandbox-mode", "Strict sandbox mode"]],
				},
			],
		],
		[
			"response style",
			[
				{
					tab: "claude-code",
					rows: [["output-style", "Output style"]],
				},
			],
		],
		// A keyword-only section hit has no rows.
		[
			"tmux",
			[
				{
					tab: "application",
					rows: [],
				},
			],
		],
		// A section-name match outranks row matches elsewhere.
		[
			"sessions",
			[
				{
					tab: "sessions",
					rows: [["sessions-page-grouping", "Sessions page grouping"]],
				},
				{
					tab: "claude-code",
					rows: [
						["archive-inactive-sessions", "Archive inactive sessions"],
						["connect-new-sessions-to-remote-control", "Connect new sessions to Remote Control"],
					],
				},
			],
		],
		// Case-insensitive, and title-only: section headings ("Code appearance") are not indexed.
		[
			"THEME",
			[
				{
					tab: "general",
					rows: [["theme", "Theme"]],
				},
			],
		],
		// The nav renames General to Appearance, so its new name finds the whole section.
		[
			"appearance",
			[
				{
					tab: "general",
					rows: [],
				},
			],
		],
		[
			"width",
			[
				{
					tab: "general",
					rows: [["transcript-width", "Transcript width"]],
				},
			],
		],
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
		// Upstream's search phrase finds the switch-models row.
		...["flagged", "switch models when"].map(
			(
				query,
			): [
				string,
				Array<
				{
					tab: string;
					rows: Array<[string, string]>;
				}>,
			] => [
				query,
				[
					{
						tab: "claude-code",
						rows: [["switch-models-local", "Switch models in Claude Code on this computer"]],
					},
				],
			],
		),
	])("groups results for %j", (query, expected) =>
	{
		const actual = rankSettingsSections(query).map((section) => (
		{
			tab: section.tab,
			rows: section.rows.map(({entry}) => [entry.rowSlug, entry.title]),
		}));
		expect(actual).toStrictEqual(expected);
	});
});

describe("settingsMatchStart", () =>
{
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
	])("locates %j in %j at %d", (label, query, expected) =>
	{
		expect(settingsMatchStart(label, query)).toBe(expected);
	});
});

describe("normalizeSettingsQuery", () =>
{
	it.each<[string, string]>([
		["Ünïcode–Font_size", "unicode font size"],
		["  Code   FONT ", "code font"],
		["working-copy__review", "working copy review"],
		["\u2018it\u2019s\u201b \u201cquoted\u201d", "'it's' \"quoted\""],
		["café", "cafe"],
		["", ""],
	])("normalizes %j to %j", (query, expected) =>
	{
		expect(normalizeSettingsQuery(query)).toBe(expected);
	});
});

describe("rankSettingsLabel", () =>
{
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
	])("ranks %j against %j as %d", (query, label, expected) =>
	{
		expect(rankSettingsLabel(query, label)).toBe(expected);
	});
});

describe("SETTINGS_SECTION_KEYWORDS", () =>
{
	it("matches the local keyword map", () =>
	{
		expect(SETTINGS_SECTION_KEYWORDS).toStrictEqual(
			{
				usage: ["overage", "extra usage", "spend limit", "usage credits"],
				"claude-config": ["settings.json"],
				application: ["herdr", "tmux"],
				"customize-connectors": ["mcp", "integrations", "tools"],
				"customize-skills": ["custom instructions", "agent skills"],
				"customize-plugins": ["marketplace", "extensions"],
			},
		);
	});
});

describe("rankSettingsSections", () =>
{
	it.each<
		[
			string,
			Array<
			{
				tab: string;
				score: number;
				keyword?: string;
				rows: Array<[string, number]>;
			}>,
		]
	>([
		["", []],
		["zzzq", []],
		// Name rank 0-3 wins outright.
		[
			"general",
			[
				{
					tab: "general",
					score: 0,
					rows: [],
				},
			],
		],
		[
			"code",
			[
				// The nav renames Claude Code to Code, an exact name match.
				{
					tab: "claude-code",
					score: 0,
					rows: [["switch-models-local", 2]],
				},
				// The Code looks moved to Appearance (upstream GeneralCodeLooks).
				{
					tab: "general",
					score: 6,
					rows: [
						["code-font", 1],
						["code-font-size", 1],
					],
				},
				{
					tab: "notifications",
					score: 6,
					rows: [["code-permission-requests", 1]],
				},
				{
					tab: "claude-config",
					score: 7,
					rows: [["claude-code-settings-files", 2]],
				},
			],
		],
		// 5 + best row rank; phrases score 4.
		[
			"mode",
			[
				{
					tab: "claude-code",
					score: 7,
					rows: [
						["switch-models-local", 2],
						["allow-bypass-permissions-mode", 2],
						["strict-sandbox-mode", 2],
					],
				},
				{
					tab: "general",
					score: 9,
					rows: [["theme", 4]],
				},
			],
		],
	])("scores sections for %j", (query, expected) =>
	{
		const actual = rankSettingsSections(query).map((section) => (
		{
			tab: section.tab,
			score: section.score,
			...(section.keyword === undefined
				? {}
				:
					{
						keyword: section.keyword,
					}),
			rows: section.rows.map((row) => [row.entry.rowSlug, row.rank]),
		}));
		expect(actual).toStrictEqual(expected);
	});

	it("scores a keyword-only hit 10 and reports the keyword", () =>
	{
		expect(
			rankSettingsSections("overage").map((section) => (
			{
				tab: section.tab,
				score: section.score,
				keyword: section.keyword,
				rows: section.rows,
			})),
		).toStrictEqual([
			{
				tab: "usage",
				score: 10,
				keyword: "overage",
				rows: [],
			},
		]);
	});
});

describe("splitMatch", () =>
{
	it("splits a title around the matched range", () =>
	{
		expect(splitMatch("Interface font", 10, 4)).toStrictEqual(
			{
				before: "Interface ",
				match: "font",
				after: "",
			},
		);
	});
});

describe("buildSettingsResultRows", () =>
{
	it.each<[string, ReturnType<typeof buildSettingsResultRows>]>([
		["", []],
		["zzzq", []],
		// Several row matches: a hit, then its children. A single row match is one via-hit.
		[
			"font",
			[
				{
					kind: "hit",
					tab: "general",
				},
				{
					kind: "child",
					tab: "general",
					rowSlug: "interface-font",
					title: "Interface font",
				},
				{
					kind: "child",
					tab: "general",
					rowSlug: "response-font",
					title: "Response font",
				},
				{
					kind: "child",
					tab: "general",
					rowSlug: "code-font",
					title: "Code font",
				},
				{
					kind: "more",
					tab: "general",
					count: 2,
				},
			],
		],
		[
			"theme",
			[
				{
					kind: "hit",
					tab: "general",
					via: "Theme",
					rowSlug: "theme",
				},
			],
		],
		// A section-name match lists its matching rows as children even when there is one.
		[
			"transcript",
			[
				{
					kind: "hit",
					tab: "transcript",
				},
				{
					kind: "child",
					tab: "transcript",
					rowSlug: "show-transcript-only-system-records",
					title: "Show transcript-only system records",
				},
				{
					kind: "hit",
					tab: "general",
				},
				{
					kind: "child",
					tab: "general",
					rowSlug: "transcript-text-size",
					title: "Transcript text size",
				},
				{
					kind: "child",
					tab: "general",
					rowSlug: "transcript-width",
					title: "Transcript width",
				},
				{
					kind: "hit",
					tab: "claude-code",
					via: "Default transcript view",
					rowSlug: "default-transcript-view",
				},
			],
		],
		// A section-name match with no matching rows is a bare hit.
		[
			"appearance",
			[
				{
					kind: "hit",
					tab: "general",
				},
			],
		],
		// A renamed section found by its old name shows that alias on its via line.
		[
			"general",
			[
				{
					kind: "hit",
					tab: "general",
					via: "General",
				},
			],
		],
		[
			"claude code",
			[
				{
					kind: "hit",
					tab: "claude-code",
					via: "Claude Code",
				},
				{
					kind: "child",
					tab: "claude-code",
					rowSlug: "switch-models-local",
					title: "Switch models in Claude Code on this computer",
				},
				{
					kind: "hit",
					tab: "claude-config",
					via: "Claude Code settings files",
					rowSlug: "claude-code-settings-files",
				},
			],
		],
		// A keyword-only hit shows the keyword on its via line and has no row.
		[
			"tmux",
			[
				{
					kind: "hit",
					tab: "application",
					via: "tmux",
				},
			],
		],
		// More than three matches: three children, then "+N more".
		[
			"hook",
			[
				{
					kind: "hit",
					tab: "transcript",
				},
				{
					kind: "child",
					tab: "transcript",
					rowSlug: "hook-warnings",
					title: "Hook warnings",
				},
				{
					kind: "child",
					tab: "transcript",
					rowSlug: "hook-errors",
					title: "Hook errors",
				},
				{
					kind: "child",
					tab: "transcript",
					rowSlug: "passed-hooks",
					title: "Passed hooks",
				},
			],
		],
		// One character: one hit per section, each with its best row on a via line; name-only
		// sections (Setup, Usage) are bare hits. Ties keep nav order.
		[
			"s",
			[
				{
					kind: "hit",
					tab: "sessions",
					via: "Sessions page grouping",
					rowSlug: "sessions-page-grouping",
				},
				{
					kind: "hit",
					tab: "setup",
				},
				{
					kind: "hit",
					tab: "notifications",
					via: "Notification sound",
					rowSlug: "notification-sound",
				},
				{
					kind: "hit",
					tab: "usage",
				},
				{
					kind: "hit",
					tab: "transcript",
					via: "System banners",
					rowSlug: "system-banners",
				},
				{
					kind: "hit",
					tab: "ai-features",
					via: "Summary button",
					rowSlug: "summary-button",
				},
				{
					kind: "hit",
					tab: "claude-code",
					via: "Switch models in Claude Code on this computer",
					rowSlug: "switch-models-local",
				},
				{
					kind: "hit",
					tab: "application",
					via: "Shell tabs",
					rowSlug: "shell-tabs",
				},
				{
					kind: "hit",
					tab: "general",
					via: "Transcript text size",
					rowSlug: "transcript-text-size",
				},
				{
					kind: "hit",
					tab: "claude-config",
					via: "Claude Code settings files",
					rowSlug: "claude-code-settings-files",
				},
			],
		],
	])("lays out rows for %j", (query, expected) =>
	{
		expect(buildSettingsResultRows(query, new Set())).toStrictEqual(expected);
	});

	it("caps a section at three children and counts the rest in a more row, unless expanded", () =>
	{
		const entries = ["Alpha one", "Alpha two", "Alpha three", "Alpha four", "Alpha five"].map((title, index) => (
		{
			entry:
			{
				tab: "general" as const,
				rowSlug: `row-${index}`,
				title,
			},
			rank: 1,
		}));
		const sections = [
			{
				tab: "general" as const,
				score: 6,
				rows: entries,
			},
		];

		expect(layoutSettingsResultRows(sections, "alpha", new Set())).toStrictEqual([
			{
				kind: "hit",
				tab: "general",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "row-0",
				title: "Alpha one",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "row-1",
				title: "Alpha two",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "row-2",
				title: "Alpha three",
			},
			{
				kind: "more",
				tab: "general",
				count: 2,
			},
		]);
		expect(layoutSettingsResultRows(sections, "alpha", new Set(["general"]))).toStrictEqual([
			{
				kind: "hit",
				tab: "general",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "row-0",
				title: "Alpha one",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "row-1",
				title: "Alpha two",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "row-2",
				title: "Alpha three",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "row-3",
				title: "Alpha four",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "row-4",
				title: "Alpha five",
			},
		]);
	});

	it("gives an alias match a via hit followed by its matching rows as children", () =>
	{
		const sections = [
			{
				tab: "general" as const,
				score: 1,
				alias: "General",
				rows: [
					{
						entry:
						{
							tab: "general" as const,
							rowSlug: "a",
							title: "General row",
						},
						rank: 1,
					},
				],
			},
		];

		expect(layoutSettingsResultRows(sections, "gen", new Set())).toStrictEqual([
			{
				kind: "hit",
				tab: "general",
				via: "General",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "a",
				title: "General row",
			},
		]);
	});

	it("drops a row label already shown under an earlier section", () =>
	{
		const sections = [
			{
				tab: "general" as const,
				score: 6,
				rows: [
					{
						entry:
						{
							tab: "general" as const,
							rowSlug: "a",
							title: "Shared",
						},
						rank: 1,
					},
					{
						entry:
						{
							tab: "general" as const,
							rowSlug: "b",
							title: "Shared two",
						},
						rank: 1,
					},
				],
			},
			{
				tab: "sessions" as const,
				score: 6,
				rows: [
					{
						entry:
						{
							tab: "sessions" as const,
							rowSlug: "c",
							title: "Shared",
						},
						rank: 1,
					},
					{
						entry:
						{
							tab: "sessions" as const,
							rowSlug: "d",
							title: "Shared three",
						},
						rank: 1,
					},
				],
			},
		];

		expect(layoutSettingsResultRows(sections, "shared", new Set())).toStrictEqual([
			{
				kind: "hit",
				tab: "general",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "a",
				title: "Shared",
			},
			{
				kind: "child",
				tab: "general",
				rowSlug: "b",
				title: "Shared two",
			},
			{
				kind: "hit",
				tab: "sessions",
				via: "Shared three",
				rowSlug: "d",
			},
		]);
	});
});

describe("rankSettingsSections search names (upstream bc() + gn alsoFoundBy)", () =>
{
	const appearance =
	{
		general:
		{
			name: "Appearance",
			alsoFoundBy: ["General"],
		},
	} as const;

	it("finds a renamed section through its old name as an alias", () =>
	{
		expect(rankSettingsSections("general", appearance)[0]).toStrictEqual(
			{
				tab: "general",
				score: 0,
				alias: "General",
				rows: [],
			},
		);
	});

	it("ignores aliases for 1-character queries", () =>
	{
		expect(rankSettingsSections("g", appearance).filter((section) => "alias" in section)).toStrictEqual([]);
	});

	it("matches the renamed name itself", () =>
	{
		expect(rankSettingsSections("appearance", appearance)[0]?.tab).toBe("general");
	});

	it("drops a row titled like its renamed section", () =>
	{
		const renamed =
		{
			general:
			{
				name: "Motion",
				alsoFoundBy: ["General"],
			},
		};
		expect(rankSettingsSections("motion", renamed)).toStrictEqual([
			{
				tab: "general",
				score: 0,
				rows: [],
			},
		]);
	});

	it("uses the real nav table by default: Appearance via General, Code via Claude Code", () =>
	{
		expect(
			rankSettingsSections("claude code").map(({tab, score, alias}) => (
			{
				tab,
				score,
				alias,
			})),
		).toStrictEqual([
			{
				tab: "claude-code",
				score: 0,
				alias: "Claude Code",
			},
			{
				tab: "claude-config",
				score: 6,
				alias: undefined,
			},
		]);
		expect(
			rankSettingsSections("appearance").map(({tab, score}) => (
			{
				tab,
				score,
			})),
		).toStrictEqual([
			{
				tab: "general",
				score: 0,
			},
		]);
	});
});

describe("Customize rows in settings search (upstream xn/gn Customize index)", () =>
{
	const skill = (id: string, name: string, source: "personal" | "project" | "plugin", sourceLabel: string) => (
	{
		id,
		name,
		description: "",
		source,
		sourceLabel,
		dir: `/skills/${name}`,
		mtime: 0,
		enabled: true,
	});
	const pluginSkill = (name: string) => (
	{
		dirname: name,
		name,
		description: "",
		skillFile:
		{
			filename: "SKILL.md",
			name,
			description: "",
			type: "skill" as const,
			frontmatter: {},
		},
		references: [],
		examples: [],
	});
	const plugin = (name: string, skills: string[]) => (
	{
		id: `${name}@market`,
		name,
		version: "1.0.0",
		versionKind: "release" as const,
		description: "",
		author: "",
		marketplace: "market",
		installPath: `/plugins/${name}`,
		agents: [],
		commands: [],
		skills: skills.map(pluginSkill),
	});
	const sources =
	{
		skills: [
			skill("personal:deep-research", "deep-research", "personal", "Personal"),
			skill("project:p1:review", "review", "project", "proj"),
			skill("project:p1:Theme", "Theme", "project", "proj"),
			skill("plugin:build@market:fix", "fix", "plugin", "build"),
		],
		commands: [
			{
				source: "global",
				sourceName: "Personal",
				commands: [
					{
						filename: "deploy.md",
						name: "deploy",
						description: "",
						type: "command" as const,
						frontmatter: {},
					},
				],
			},
		],
		servers: [
			{
				id: "user:cloudflare",
				name: "cloudflare",
				scope: "user" as const,
				transport: "http",
				urlOrCommand: "https://example.com/mcp",
				enabled: true,
				envKeys: [],
				headerKeys: [],
				needsAuth: false,
				offIn: [],
			},
		],
		claudeAi: [
			{
				key: "gmail",
				name: "Gmail",
				tools: [],
			},
		],
		plugins: [plugin("build", ["fix"]), plugin("ops", ["fix"])],
	};
	const index = buildCustomizeIndex(sources);
	const customizeRows = (query: string, expanded: ReadonlySet<SettingsSearchSection> = new Set()) =>
		buildSettingsResultRows(query, expanded, index).filter((row) => row.tab.startsWith("customize-"));
	const skillTarget = (id: string) => (
	{
		kind: "skill" as const,
		id,
		tab: "overview" as const,
	});

	it("indexes skills, commands, connectors and plugins under the three sections", () =>
	{
		expect(index).toStrictEqual(
			{
				"customize-skills": [
					{
						rowSlug: "skill:personal:deep-research",
						title: "deep-research",
						target: skillTarget("personal:deep-research"),
					},
					{
						rowSlug: "skill:project:p1:review",
						title: "review",
						target: skillTarget("project:p1:review"),
					},
					{
						rowSlug: "skill:project:p1:Theme",
						title: "Theme",
						target: skillTarget("project:p1:Theme"),
					},
					{
						rowSlug: "skill:plugin:build@market:fix",
						title: "fix · build",
						searchText: "fix build",
						target: skillTarget("plugin:build@market:fix"),
					},
					{
						rowSlug: "command:global:deploy.md",
						title: "/deploy",
						target:
						{
							kind: "command",
							source: "global",
							filename: "deploy.md",
						},
					},
				],
				"customize-connectors": [
					{
						rowSlug: "connector:dXNlcjpjbG91ZGZsYXJl",
						title: "cloudflare",
						target:
						{
							kind: "connector",
							slug: "dXNlcjpjbG91ZGZsYXJl",
						},
					},
					{
						rowSlug: "list:connectors",
						title: "Gmail",
						target:
						{
							kind: "list",
							section: "connectors",
						},
					},
				],
				"customize-plugins": [
					{
						rowSlug: "plugin:build@market",
						title: "build",
						target:
						{
							kind: "plugin",
							id: "build@market",
							tab: "overview",
						},
					},
					{
						rowSlug: "plugin:ops@market",
						title: "ops",
						target:
						{
							kind: "plugin",
							id: "ops@market",
							tab: "overview",
						},
					},
					{
						rowSlug: "skill:plugin:build@market:fix",
						title: "fix · build",
						searchText: "fix build",
						target: skillTarget("plugin:build@market:fix"),
						collapseKey: "plugin-skill\0fix",
					},
					{
						rowSlug: "skill:plugin:ops@market:fix",
						title: "fix · ops",
						searchText: "fix ops",
						target: skillTarget("plugin:ops@market:fix"),
						collapseKey: "plugin-skill\0fix",
					},
				],
			},
		);
	});

	it("lists a name-matched Customize section with only its matching rows", () =>
	{
		expect(customizeRows("skills")).toStrictEqual([
			{
				kind: "hit",
				tab: "customize-skills",
			},
		]);
	});

	it("caps several matching skills at three children and a more row, ties in index order", () =>
	{
		const many = buildCustomizeIndex(
			{
				...sources,
				skills: ["rebase", "refactor", "release", "review"].map((name) =>
					skill(`personal:${name}`, name, "personal", "Personal"),
				),
				commands: [],
			},
		);
		const child = (name: string) => (
		{
			kind: "child",
			tab: "customize-skills",
			rowSlug: `skill:personal:${name}`,
			title: name,
			target: skillTarget(`personal:${name}`),
		});
		expect(
			buildSettingsResultRows("re", new Set(), many).filter((row) => row.tab === "customize-skills"),
		).toStrictEqual([
			{
				kind: "hit",
				tab: "customize-skills",
			},
			child("rebase"),
			child("refactor"),
			child("release"),
			{
				kind: "more",
				tab: "customize-skills",
				count: 1,
			},
		]);
	});

	it("drops a plugin skill shown under Skills from Plugins and collapses same-named plugin skills", () =>
	{
		expect(customizeRows("fix")).toStrictEqual([
			{
				kind: "hit",
				tab: "customize-skills",
				via: "fix · build",
				rowSlug: "skill:plugin:build@market:fix",
				target: skillTarget("plugin:build@market:fix"),
			},
			{
				kind: "hit",
				tab: "customize-plugins",
				via: "fix · ops",
				rowSlug: "skill:plugin:ops@market:fix",
				target: skillTarget("plugin:ops@market:fix"),
			},
		]);
	});

	it("finds a plugin and a connector by name", () =>
	{
		// The exact plugin name (score 5) sorts before the word-start skill match (score 7).
		expect(customizeRows("build")).toStrictEqual([
			{
				kind: "hit",
				tab: "customize-plugins",
				via: "build",
				rowSlug: "plugin:build@market",
				target:
				{
					kind: "plugin",
					id: "build@market",
					tab: "overview",
				},
			},
			{
				kind: "hit",
				tab: "customize-skills",
				via: "fix · build",
				rowSlug: "skill:plugin:build@market:fix",
				target: skillTarget("plugin:build@market:fix"),
			},
		]);
		expect(customizeRows("cloud")).toStrictEqual([
			{
				kind: "hit",
				tab: "customize-connectors",
				via: "cloudflare",
				rowSlug: "connector:dXNlcjpjbG91ZGZsYXJl",
				target:
				{
					kind: "connector",
					slug: "dXNlcjpjbG91ZGZsYXJl",
				},
			},
		]);
	});

	it("keeps a label shown in a settings tab under Skills too", () =>
	{
		expect(buildSettingsResultRows("theme", new Set(), index)).toStrictEqual([
			{
				kind: "hit",
				tab: "general",
				via: "Theme",
				rowSlug: "theme",
			},
			{
				kind: "hit",
				tab: "customize-skills",
				via: "Theme",
				rowSlug: "skill:project:p1:Theme",
				target: skillTarget("project:p1:Theme"),
			},
		]);
	});

	it("gives a 1-character query one via-hit per Customize section", () =>
	{
		expect(customizeRows("f").map((row) => [row.kind, row.tab, "via" in row ? row.via : undefined])).toStrictEqual([
			["hit", "customize-skills", "fix · build"],
			["hit", "customize-plugins", "fix · ops"],
			// cloudflare matches mid-word (rank 3), so Connectors sorts after the prefix matches.
			["hit", "customize-connectors", "cloudflare"],
		]);
	});

	it("finds Customize sections by upstream's keywords", () =>
	{
		expect(buildSettingsResultRows("marketplace", new Set(), index)).toStrictEqual([
			{
				kind: "hit",
				tab: "customize-plugins",
				via: "marketplace",
			},
		]);
		expect(buildSettingsResultRows("mcp", new Set(), index)).toStrictEqual([
			{
				kind: "hit",
				tab: "ai-features",
				via: "Read-only MCP server",
				rowSlug: "read-only-mcp-server",
			},
			{
				kind: "hit",
				tab: "customize-connectors",
				via: "mcp",
			},
		]);
	});
});

describe("compact matching (upstream pn)", () =>
{
	it.each<[string, string, number]>([
		["tsi", "Font size", 3],
		["zz", "Font size", -1],
	])("ranks %j against %j as %d", (query, label, expected) =>
	{
		expect(rankSettingsLabel(query, label)).toBe(expected);
	});

	it("matches a keyword across its spaces", () =>
	{
		expect(
			rankSettingsSections("extrausage").map(({tab, score, keyword}) => (
			{
				tab,
				score,
				keyword,
			})),
		).toStrictEqual([
			{
				tab: "usage",
				score: 10,
				keyword: "extra usage",
			},
		]);
	});
});
