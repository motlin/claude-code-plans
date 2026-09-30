import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {McpServerListResponse} from "../src/lib/api/customize";
import {listMcpServers} from "../src/lib/customize/mcp";

let root: string;
let claudeDir: string;
let claudeJsonPath: string;
let projectPath: string;
let otherProjectPath: string;
let pluginPath: string;
let flatPluginPath: string;

const SECRET_ENV = "sk-env-secret-value-123";
const SECRET_HEADER = "Bearer header-secret-value-456";
const SECRET_PLUGIN_HEADER = "plugin-secret-token-789";

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, JSON.stringify(value, null, 2));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "customize-mcp-"));
	claudeDir = join(root, "claude");
	claudeJsonPath = join(root, ".claude.json");
	projectPath = join(root, "repos", "my-app");
	otherProjectPath = join(root, "repos", "other");
	pluginPath = join(root, "plugin-cache", "docs", "1.0.0");
	flatPluginPath = join(root, "plugin-cache", "flat", "2.0.0");
	mkdirSync(claudeDir, {recursive: true});
	mkdirSync(otherProjectPath, {recursive: true});
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

function writeFixtures(): void {
	writeJson(claudeJsonPath, {
		numStartups: 42,
		mcpServers: {
			mail: {
				type: "stdio",
				command: "npx",
				args: ["-y", "mail-mcp"],
				env: {MAIL_TOKEN: SECRET_ENV},
			},
			sentry: {type: "http", url: "https://mcp.sentry.dev/mcp"},
		},
		projects: {
			[projectPath]: {
				hasTrustDialogAccepted: true,
				lastCost: 1.5,
				mcpServers: {
					render: {
						type: "http",
						url: "https://mcp.render.com/mcp",
						headers: {Authorization: SECRET_HEADER},
					},
					scratch: {command: "scratch-mcp"},
				},
				disabledMcpServers: ["scratch"],
				enabledMcpjsonServers: ["approved"],
				disabledMcpjsonServers: ["rejected"],
			},
			[otherProjectPath]: {
				allowedTools: [],
			},
		},
	});

	writeJson(join(projectPath, ".mcp.json"), {
		mcpServers: {
			approved: {type: "sse", url: "https://example.com/sse"},
			rejected: {command: "node", args: ["server.js"], cwd: "tools"},
			pending: {command: "pending-mcp"},
		},
	});

	writeJson(join(claudeDir, "settings.json"), {
		enabledPlugins: {"docs@market": true, "flat@market": false},
	});

	writeJson(join(claudeDir, "plugins", "installed_plugins.json"), {
		version: 2,
		plugins: {
			"docs@market": [
				{
					scope: "user",
					installPath: pluginPath,
					version: "1.0.0",
					installedAt: "2026-09-01T00:00:00.000Z",
					lastUpdated: "2026-09-01T00:00:00.000Z",
				},
			],
			"flat@market": [
				{
					scope: "user",
					installPath: flatPluginPath,
					version: "2.0.0",
					installedAt: "2026-09-01T00:00:00.000Z",
					lastUpdated: "2026-09-01T00:00:00.000Z",
				},
			],
		},
	});

	writeJson(join(pluginPath, ".mcp.json"), {
		mcpServers: {
			docs: {
				type: "http",
				url: "https://docs.example.com/mcp",
				headers: {"X-Api-Key": SECRET_PLUGIN_HEADER},
				timeout: 60000,
				tool_timeout_sec: 60,
			},
		},
	});

	writeJson(join(flatPluginPath, ".mcp.json"), {
		browser: {command: "npx", args: ["browser-mcp@latest"]},
	});
}

describe("listMcpServers", () => {
	it("inventories user, local, project, and plugin servers", async () => {
		writeFixtures();

		const servers = await listMcpServers({claudeDir, claudeJsonPath});

		expect(servers).toStrictEqual([
			{
				id: "user:mail",
				name: "mail",
				scope: "user",
				transport: "stdio",
				urlOrCommand: "npx -y mail-mcp",
				enabled: true,
				envKeys: ["MAIL_TOKEN"],
				headerKeys: [],
			},
			{
				id: "user:sentry",
				name: "sentry",
				scope: "user",
				transport: "http",
				urlOrCommand: "https://mcp.sentry.dev/mcp",
				enabled: true,
				envKeys: [],
				headerKeys: [],
			},
			{
				id: `local:${projectPath}:render`,
				name: "render",
				scope: "local",
				transport: "http",
				urlOrCommand: "https://mcp.render.com/mcp",
				enabled: true,
				projectPath,
				envKeys: [],
				headerKeys: ["Authorization"],
			},
			{
				id: `local:${projectPath}:scratch`,
				name: "scratch",
				scope: "local",
				transport: "stdio",
				urlOrCommand: "scratch-mcp",
				enabled: false,
				projectPath,
				envKeys: [],
				headerKeys: [],
			},
			{
				id: `project:${projectPath}:approved`,
				name: "approved",
				scope: "project",
				transport: "sse",
				urlOrCommand: "https://example.com/sse",
				enabled: true,
				projectPath,
				envKeys: [],
				headerKeys: [],
			},
			{
				id: `project:${projectPath}:pending`,
				name: "pending",
				scope: "project",
				transport: "stdio",
				urlOrCommand: "pending-mcp",
				enabled: false,
				projectPath,
				envKeys: [],
				headerKeys: [],
			},
			{
				id: `project:${projectPath}:rejected`,
				name: "rejected",
				scope: "project",
				transport: "stdio",
				urlOrCommand: "node server.js",
				enabled: false,
				projectPath,
				envKeys: [],
				headerKeys: [],
			},
			{
				id: "plugin:docs@market:docs",
				name: "docs",
				scope: "plugin",
				transport: "http",
				urlOrCommand: "https://docs.example.com/mcp",
				enabled: true,
				envKeys: [],
				headerKeys: ["X-Api-Key"],
			},
			{
				id: "plugin:flat@market:browser",
				name: "browser",
				scope: "plugin",
				transport: "stdio",
				urlOrCommand: "npx browser-mcp@latest",
				enabled: false,
				envKeys: [],
				headerKeys: [],
			},
		]);
		expect(McpServerListResponse.parse(servers)).toStrictEqual(servers);
	});

	it("never serializes env or header values", async () => {
		writeFixtures();

		const serialized = JSON.stringify(await listMcpServers({claudeDir, claudeJsonPath}));

		expect([
			serialized.includes(SECRET_ENV),
			serialized.includes(SECRET_HEADER),
			serialized.includes(SECRET_PLUGIN_HEADER),
		]).toStrictEqual([false, false, false]);
	});

	it("enables every project server when enableAllProjectMcpServers is set", async () => {
		writeJson(claudeJsonPath, {projects: {[projectPath]: {}}});
		writeJson(join(projectPath, ".mcp.json"), {mcpServers: {any: {command: "any-mcp"}}});
		writeJson(join(claudeDir, "settings.json"), {enableAllProjectMcpServers: true});

		expect(await listMcpServers({claudeDir, claudeJsonPath})).toStrictEqual([
			{
				id: `project:${projectPath}:any`,
				name: "any",
				scope: "project",
				transport: "stdio",
				urlOrCommand: "any-mcp",
				enabled: true,
				projectPath,
				envKeys: [],
				headerKeys: [],
			},
		]);
	});

	it("returns an empty list when nothing is configured", async () => {
		expect(await listMcpServers({claudeDir, claudeJsonPath})).toStrictEqual([]);
	});
});
