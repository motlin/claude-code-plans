import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	categoryCounts,
	discoverCategoryOptions,
	discoverForSection,
	filterDiscover,
	formatExactInstalls,
	formatInstallCount,
	groupDiscoverSearch,
	isCatalogStale,
	mostInstalled,
	recentlyUpdated,
	sortDiscover,
} from "../src/components/customize/discover-view";
import type {DiscoverPlugin} from "../src/lib/api/customize";
import {readDiscoverCatalog} from "../src/lib/customize/discover";
import {PluginCatalogCacheSchema} from "../src/lib/schemas";

function catalogPlugin(overrides: Record<string, unknown> = {}) {
	return {
		plugin: "deploy",
		tokens: {"claude-opus-4-7": {always_on: 10, on_invoke: 20}},
		components: {
			commands: [{name: "ship", chars: {always_on: 1, on_invoke: 2}}],
			agents: [],
			skills: [
				{name: "deploy-checklist", chars: {always_on: 1, on_invoke: 2}},
				{name: "rollback", chars: {always_on: 1, on_invoke: 2}},
			],
			hooks: ["PreToolUse"],
			mcpServers: ["github"],
			lspServers: [],
		},
		unique_installs: 8_340_370,
		last_updated: "2026-09-20T10:00:00-07:00",
		marketplace_entry: {
			name: "deploy",
			description: "Ship safely.",
			author: {name: "Anthropic", email: "support@anthropic.com"},
			category: "deployment",
			source: {
				source: "git-subdir",
				url: "https://github.com/example/plugins.git",
				path: "plugins/deploy",
				ref: "v1.0.0",
				sha: "abc",
			},
			homepage: "https://example.com",
		},
		version: "1.2.0",
		source: "deploy@claude-plugins-official",
		sha: "abc",
		source_sha: "abc",
		...overrides,
	};
}

function catalogFile(plugins: Record<string, unknown>, fetchedAt = "2026-09-25T12:00:00.000Z") {
	return {
		version: 1,
		fetchedAt,
		catalog: {
			generated_at: "2026-09-25T07:40:56.440Z",
			installs_generated_at: "2026-09-24T06:00:31.271415+00:00",
			marketplace_sha: "ed40",
			models: ["claude-opus-4-7"],
			plugins,
		},
	};
}

function plugin(overrides: Partial<DiscoverPlugin>): DiscoverPlugin {
	return {
		id: "p@claude-plugins-official",
		name: "p",
		title: "p",
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

describe("formatInstallCount", () => {
	it("abbreviates counts the way upstream Discover cards do", () => {
		expect([8_340_370, 1_211_610, 12_500, 2_843, 999, 0].map(formatInstallCount)).toStrictEqual([
			"8.3M",
			"1.2M",
			"12.5K",
			"2.8K",
			"999",
			"0",
		]);
	});

	it("spells out the exact count for the tooltip", () => {
		expect([formatExactInstalls(8_340_370), formatExactInstalls(1)]).toStrictEqual([
			"8,340,370 installs",
			"1 install",
		]);
	});
});

describe("PluginCatalogCacheSchema", () => {
	it("accepts every observed catalog shape", () => {
		const parsed = PluginCatalogCacheSchema.safeParse(
			catalogFile({
				"deploy@claude-plugins-official": catalogPlugin(),
				"lsp@claude-plugins-official": catalogPlugin({
					plugin: "lsp",
					unique_installs: undefined,
					version: undefined,
					marketplace_entry: {
						name: "lsp",
						displayName: "LSP",
						description: "Language servers.",
						source: "./plugins/lsp",
						strict: false,
						version: "1.0.0",
						tags: ["community-managed"],
						keywords: ["lsp"],
						skills: ["./skills/lsp"],
						lspServers: {
							pyright: {
								command: "pyright-langserver",
								args: ["--stdio"],
								extensionToLanguage: {".py": "python"},
								startupTimeout: 1000,
							},
						},
					},
				}),
			}),
		);
		expect(parsed.success).toBe(true);
	});

	it("rejects unknown keys", () => {
		const withExtra = catalogFile({
			"deploy@claude-plugins-official": catalogPlugin({surprise: true}),
		});
		const withSourceKind = catalogFile({
			"deploy@claude-plugins-official": catalogPlugin({
				marketplace_entry: {
					name: "deploy",
					description: "Ship safely.",
					source: {source: "npm", url: "x"},
				},
			}),
		});
		expect([
			PluginCatalogCacheSchema.safeParse(withExtra).success,
			PluginCatalogCacheSchema.safeParse(withSourceKind).success,
		]).toStrictEqual([false, false]);
	});

	it("parses the catalog on disk when present", () => {
		const path = join(homedir(), ".claude", "plugins", "plugin-catalog-cache.json");
		if (!existsSync(path)) return;
		const result = PluginCatalogCacheSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
		expect(result.error?.issues.slice(0, 5)).toBeUndefined();
	});
});

describe("readDiscoverCatalog", () => {
	let claudeDir: string;

	function write(path: string, content: unknown) {
		mkdirSync(dirname(path), {recursive: true});
		writeFileSync(path, JSON.stringify(content));
	}

	beforeEach(() => {
		claudeDir = mkdtempSync(join(tmpdir(), "customize-discover-"));
	});

	afterEach(() => {
		rmSync(claudeDir, {recursive: true, force: true});
	});

	it("merges the catalog with marketplace manifests and marks installed plugins", async () => {
		write(
			join(claudeDir, "plugins", "plugin-catalog-cache.json"),
			catalogFile({"deploy@claude-plugins-official": catalogPlugin()}),
		);
		write(join(claudeDir, "plugins", "installed_plugins.json"), {
			version: 2,
			plugins: {
				"tidy@community": [
					{
						scope: "user",
						installPath: "/x",
						version: "1.0.0",
						installedAt: "2026-09-01T00:00:00.000Z",
						lastUpdated: "2026-09-02T00:00:00.000Z",
					},
				],
			},
		});
		write(
			join(claudeDir, "plugins", "marketplaces", "claude-plugins-official", ".claude-plugin", "marketplace.json"),
			{name: "claude-plugins-official", plugins: [{name: "deploy", description: "dup"}]},
		);
		write(join(claudeDir, "plugins", "marketplaces", "community", ".claude-plugin", "marketplace.json"), {
			name: "community",
			plugins: [
				{
					name: "tidy",
					description: "Tidy up.",
					author: {name: "Someone"},
					category: "productivity",
					source: "./tidy",
					skills: ["./skills/tidy"],
				},
			],
		});

		expect(await readDiscoverCatalog({claudeDir})).toStrictEqual({
			fetchedAt: "2026-09-25T12:00:00.000Z",
			plugins: [
				{
					id: "deploy@claude-plugins-official",
					name: "deploy",
					title: "deploy",
					marketplace: "claude-plugins-official",
					description: "Ship safely.",
					author: "Anthropic",
					category: "deployment",
					installs: 8_340_370,
					lastUpdated: "2026-09-20T10:00:00-07:00",
					skills: ["deploy-checklist", "rollback"],
					installed: false,
				},
				{
					id: "tidy@community",
					name: "tidy",
					title: "tidy",
					marketplace: "community",
					description: "Tidy up.",
					author: "Someone",
					category: "productivity",
					installs: null,
					lastUpdated: null,
					skills: ["tidy"],
					installed: true,
				},
			],
		});
	});

	it("returns an empty catalog when nothing is on disk", async () => {
		expect(await readDiscoverCatalog({claudeDir})).toStrictEqual({
			fetchedAt: null,
			plugins: [],
		});
	});
});

describe("discover view", () => {
	const big = plugin({
		id: "big@m",
		name: "big",
		title: "Big",
		installs: 900,
		lastUpdated: "2026-09-01T00:00:00Z",
		category: "development",
		skills: ["a"],
	});
	const fresh = plugin({
		id: "fresh@m",
		name: "fresh",
		title: "Fresh",
		installs: 10,
		lastUpdated: "2026-09-20T00:00:00Z",
		category: "development",
		description: "Deploy things",
	});
	const unknown = plugin({
		id: "unknown@m",
		name: "unknown",
		title: "Unknown",
		category: "design",
	});
	const installed = plugin({
		id: "mine@m",
		name: "mine",
		title: "Mine",
		installs: 50,
		description: "deploy helper",
		installed: true,
		skills: ["deploy"],
	});
	const all = [unknown, fresh, installed, big];

	it("ranks by installs and by update time, skipping missing values", () => {
		expect({
			most: mostInstalled(all, 3).map((entry) => entry.name),
			recent: recentlyUpdated(all, 5).map((entry) => entry.name),
		}).toStrictEqual({most: ["big", "mine", "fresh"], recent: ["fresh", "big"]});
	});

	it("counts categories, most first then by name", () => {
		expect(categoryCounts(all)).toStrictEqual([
			{category: "development", count: 2},
			{category: "design", count: 1},
		]);
	});

	it("sorts the filtered grid by installs, by update time, or by name", () => {
		expect({
			installs: sortDiscover(all, "installs").map((entry) => entry.name),
			recent: sortDiscover(all, "recent").map((entry) => entry.name),
			name: sortDiscover(all, "name").map((entry) => entry.name),
			unknownValue: sortDiscover(all, "bogus").map((entry) => entry.name),
		}).toStrictEqual({
			installs: ["big", "mine", "fresh", "unknown"],
			recent: ["fresh", "big", "mine", "unknown"],
			name: ["big", "fresh", "mine", "unknown"],
			unknownValue: ["big", "mine", "fresh", "unknown"],
		});
	});

	it("filters to one category, case-insensitively, and keeps everything for All categories", () => {
		expect({
			development: filterDiscover(all, "Development").map((entry) => entry.name),
			design: filterDiscover(all, "design").map((entry) => entry.name),
			all: filterDiscover(all, "all").map((entry) => entry.name),
			none: filterDiscover(all, undefined).map((entry) => entry.name),
		}).toStrictEqual({
			development: ["fresh", "big"],
			design: ["unknown"],
			all: ["unknown", "fresh", "mine", "big"],
			none: ["unknown", "fresh", "mine", "big"],
		});
	});

	it("lists All categories first, then categories by plugin count", () => {
		expect(discoverCategoryOptions(all)).toStrictEqual([
			{value: "all", label: "All categories"},
			{value: "development", label: "Development"},
			{value: "design", label: "Design"},
		]);
	});

	it("shows only skill-bearing plugins in the Skills section", () => {
		expect({
			skills: discoverForSection(all, "skills").map((entry) => entry.name),
			plugins: discoverForSection(all, "plugins").map((entry) => entry.name),
		}).toStrictEqual({
			skills: ["mine", "big"],
			plugins: ["unknown", "fresh", "mine", "big"],
		});
	});

	it("groups search results into Yours and More you can add", () => {
		const yours = [{name: "deploy-checklist"}, {name: "lint"}];
		expect(groupDiscoverSearch(yours, (item) => [item.name], all, "DEPLOY")).toStrictEqual({
			yours: [{name: "deploy-checklist"}],
			more: [fresh],
		});
	});

	it("flags a catalog fetched more than 14 days ago as stale", () => {
		const now = Date.parse("2026-09-29T00:00:00Z");
		expect([
			isCatalogStale("2026-09-15T00:00:00Z", now),
			isCatalogStale("2026-09-14T23:59:59Z", now),
			isCatalogStale(null, now),
		]).toStrictEqual([false, true, false]);
	});
});
