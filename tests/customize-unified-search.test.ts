import {describe, expect, it} from "vite-plus/test";
import {
	buildUnifiedSearch,
	searchTermReady,
	type UnifiedSearchSources,
} from "../src/components/customize/unified-search";
import type {ClaudeAiConnectorSummary, DiscoverPlugin, McpServerSummary, SkillSummary} from "../src/lib/api/customize";
import type {PluginInfoData, UserCommandGroupData} from "../src/lib/api/plugins";

function skill(overrides: Partial<SkillSummary> & Pick<SkillSummary, "id" | "name">): SkillSummary {
	return {
		description: "",
		source: "personal",
		sourceLabel: "Personal",
		dir: `/skills/${overrides.name}`,
		mtime: 0,
		enabled: true,
		...overrides,
	};
}

function server(overrides: Partial<McpServerSummary> & Pick<McpServerSummary, "id" | "name">): McpServerSummary {
	return {
		scope: "user",
		transport: "stdio",
		urlOrCommand: "npx server",
		enabled: true,
		envKeys: [],
		headerKeys: [],
		needsAuth: false,
		...overrides,
	};
}

function plugin(overrides: Partial<PluginInfoData> & Pick<PluginInfoData, "id" | "name">): PluginInfoData {
	return {
		version: "1.0.0",
		versionKind: "release",
		description: "",
		author: "",
		marketplace: "claude-plugins-official",
		installPath: `/plugins/${overrides.name}`,
		agents: [],
		commands: [],
		skills: [],
		...overrides,
	};
}

function catalog(overrides: Partial<DiscoverPlugin> & Pick<DiscoverPlugin, "id" | "name">): DiscoverPlugin {
	return {
		title: overrides.name,
		marketplace: "claude-plugins-official",
		description: "",
		author: null,
		category: null,
		installs: null,
		lastUpdated: null,
		skills: [],
		installed: false,
		...overrides,
	};
}

const commands: UserCommandGroupData[] = [
	{
		source: "personal",
		sourceName: "Personal",
		commands: [
			{
				filename: "mcp-check.md",
				name: "mcp-check",
				description: "Check servers",
				type: "command",
				frontmatter: {},
			},
			{filename: "deploy.md", name: "deploy", description: "Ship it", type: "command", frontmatter: {}},
		],
	},
];

const claudeAi: ClaudeAiConnectorSummary[] = [
	{key: "claude.ai Linear", name: "Linear MCP", tools: []},
	{key: "claude.ai Gmail", name: "Gmail", tools: []},
];

const sources: UnifiedSearchSources = {
	skills: [
		skill({id: "personal:writer", name: "writer", description: "Uses MCP for drafts"}),
		skill({
			id: "plugin:mcp-builder@claude-plugins-official:mcp-builder",
			name: "mcp-builder",
			description: "Build MCP servers",
			source: "plugin",
			sourceLabel: "mcp-builder",
		}),
		skill({
			id: "plugin:mcp-tools@community:mcp-lint",
			name: "mcp-lint",
			source: "plugin",
			sourceLabel: "mcp-tools",
		}),
		skill({id: "personal:poetry", name: "poetry"}),
	],
	commands,
	servers: [
		server({id: "user:github", name: "github"}),
		server({id: "user:mcp-proxy", name: "mcp-proxy", transport: "http", urlOrCommand: "https://mcp.example.com/"}),
	],
	claudeAi,
	plugins: [
		plugin({id: "mcp-builder@claude-plugins-official", name: "mcp-builder", description: "Skills for MCP"}),
		plugin({id: "mcp-tools@community", name: "mcp-tools", marketplace: "community"}),
		plugin({id: "poems@claude-plugins-official", name: "poems"}),
	],
	catalog: [
		catalog({id: "low@claude-plugins-official", name: "low", description: "An MCP helper", installs: 10}),
		catalog({id: "high@claude-plugins-official", name: "high", title: "High MCP", installs: 500}),
		catalog({id: "none@community", name: "mcp-none", marketplace: "community"}),
		catalog({id: "skills-only@claude-plugins-official", name: "skills-only", skills: ["mcp-review"], installs: 50}),
		catalog({id: "mcp-builder@claude-plugins-official", name: "mcp-builder", installed: true, installs: 9000}),
		catalog({id: "other@claude-plugins-official", name: "other", installs: 9000}),
	],
	marketplaceRepos: new Map([["claude-plugins-official", "anthropics/claude-plugins-official"]]),
};

describe("searchTermReady", () => {
	it("needs two letters or digits", () => {
		expect([
			searchTermReady("e"),
			searchTermReady("  g h "),
			searchTermReady("--"),
			searchTermReady("é1"),
			searchTermReady(""),
		]).toStrictEqual([false, true, false, true, false]);
	});
});

describe("buildUnifiedSearch", () => {
	it("returns Yours (skills, commands, connectors, plugins) and More (addable catalog plugins, most installed first)", () => {
		expect(buildUnifiedSearch(sources, "mcp")).toStrictEqual({
			yours: [
				{
					key: "skill:plugin:mcp-builder@claude-plugins-official:mcp-builder",
					kind: "Skill",
					name: "mcp-builder",
					byline: "from mcp-builder",
					description: "Build MCP servers",
					verified: true,
					match: [0, 3],
					open: {
						kind: "skill",
						id: "plugin:mcp-builder@claude-plugins-official:mcp-builder",
						tab: "overview",
					},
				},
				{
					key: "skill:plugin:mcp-tools@community:mcp-lint",
					kind: "Skill",
					name: "mcp-lint",
					byline: "from mcp-tools",
					description: "",
					verified: false,
					match: [0, 3],
					open: {kind: "skill", id: "plugin:mcp-tools@community:mcp-lint", tab: "overview"},
				},
				{
					key: "skill:personal:writer",
					kind: "Skill",
					name: "writer",
					byline: "from Personal",
					description: "Uses MCP for drafts",
					verified: false,
					match: null,
					open: {kind: "skill", id: "personal:writer", tab: "overview"},
				},
				{
					key: "command:personal:mcp-check.md",
					kind: "Custom command",
					name: "/mcp-check",
					byline: "from Personal",
					description: "Check servers",
					verified: false,
					match: [1, 4],
					open: null,
				},
				{
					key: "server:user:mcp-proxy",
					kind: "Connector",
					name: "mcp-proxy",
					byline: "User",
					description: "https://mcp.example.com/",
					verified: false,
					match: [0, 3],
					open: {kind: "connector", slug: "dXNlcjptY3AtcHJveHk"},
				},
				{
					key: "claude-ai:claude.ai Linear",
					kind: "Connector",
					name: "Linear MCP",
					byline: "claude.ai",
					description: "",
					verified: false,
					match: [7, 10],
					open: {kind: "external", href: "https://claude.ai/customize/connectors/yours"},
				},
				{
					key: "plugin:mcp-builder@claude-plugins-official",
					kind: "Plugin",
					name: "mcp-builder",
					byline: "from Claude Plugins Official",
					description: "Skills for MCP",
					verified: true,
					match: [0, 3],
					open: {kind: "plugin", id: "mcp-builder@claude-plugins-official", tab: "overview"},
				},
				{
					key: "plugin:mcp-tools@community",
					kind: "Plugin",
					name: "mcp-tools",
					byline: "from Community",
					description: "",
					verified: false,
					match: [0, 3],
					open: {kind: "plugin", id: "mcp-tools@community", tab: "overview"},
				},
			],
			more: [
				{
					key: "catalog:high@claude-plugins-official",
					kind: "Plugin",
					name: "High MCP",
					byline: "anthropics/claude-plugins-official",
					description: "",
					verified: true,
					match: [5, 8],
					open: null,
				},
				{
					key: "catalog:skills-only@claude-plugins-official",
					kind: "Plugin",
					name: "skills-only",
					byline: "anthropics/claude-plugins-official",
					description: "",
					verified: true,
					match: null,
					open: null,
				},
				{
					key: "catalog:low@claude-plugins-official",
					kind: "Plugin",
					name: "low",
					byline: "anthropics/claude-plugins-official",
					description: "An MCP helper",
					verified: true,
					match: null,
					open: null,
				},
				{
					key: "catalog:none@community",
					kind: "Plugin",
					name: "mcp-none",
					byline: "community",
					description: "",
					verified: false,
					match: [0, 3],
					open: null,
				},
			],
		});
	});

	it("trims the term before matching", () => {
		expect(buildUnifiedSearch(sources, "  POETRY ").yours.map((hit) => [hit.key, hit.match])).toStrictEqual([
			["skill:personal:poetry", [0, 6]],
		]);
	});

	it("slices the term to 200 code points", () => {
		const long = `poetry${"😀".repeat(300)}`;
		const named = {...sources, skills: [skill({id: "personal:long", name: `poetry${"😀".repeat(200)}`})]};
		expect(buildUnifiedSearch(named, long).yours.map((hit) => [hit.key, hit.match])).toStrictEqual([
			["skill:personal:long", [0, 6 + 2 * 194]],
		]);
	});

	it("returns nothing until the term is ready", () => {
		expect(buildUnifiedSearch(sources, "m")).toStrictEqual({yours: [], more: []});
	});
});
