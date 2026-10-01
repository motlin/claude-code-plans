import {mkdirSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	blanketChoice,
	claudeAiConnectors,
	fromConnectorSlug,
	isReadOnlyToolName,
	mcpServerKey,
	mcpToolsForServer,
	mergePermissionRules,
	parseMcpToolName,
	resolveToolPermission,
	setToolPermission,
	toConnectorSlug,
	toolPermissionChoice,
} from "../src/lib/customize/mcp-tool-permissions";
import {readMcpServerDetail} from "../src/lib/customize/mcp";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {indexJsonlFile} from "../src/lib/db/indexer";
import {listMcpToolNames} from "../src/lib/db/queries";

describe("mcpServerKey", () => {
	it("normalizes names the way the CLI prefixes tool names", () => {
		expect([
			mcpServerKey({id: "user:imcp", name: "imcp", scope: "user"}),
			mcpServerKey({id: "user:my.server", name: "my.server", scope: "user"}),
			mcpServerKey({
				id: "plugin:playwright@claude-plugins-official:playwright",
				name: "playwright",
				scope: "plugin",
			}),
			mcpServerKey({
				id: "plugin:chrome-devtools-mcp@official:chrome-devtools",
				name: "chrome-devtools",
				scope: "plugin",
			}),
		]).toStrictEqual([
			"imcp",
			"my_server",
			"plugin_playwright_playwright",
			"plugin_chrome-devtools-mcp_chrome-devtools",
		]);
	});
});

describe("parseMcpToolName", () => {
	it("splits server key and tool, rejecting non-MCP names", () => {
		expect([
			parseMcpToolName("mcp__imcp__contacts_search"),
			parseMcpToolName("mcp__claude_ai_Gmail__search_threads"),
			parseMcpToolName("mcp__imcp"),
			parseMcpToolName("Bash"),
		]).toStrictEqual([
			{serverKey: "imcp", tool: "contacts_search"},
			{serverKey: "claude_ai_Gmail", tool: "search_threads"},
			null,
			null,
		]);
	});
});

describe("mcpToolsForServer", () => {
	it("returns the distinct sorted tool names seen for one server, ignoring wildcards", () => {
		expect(
			mcpToolsForServer(
				[
					"mcp__render__list_services",
					"mcp__render__get_deploy",
					"mcp__render__list_services",
					"mcp__render__*",
					"mcp__render",
					"mcp__renderer__other",
					"Bash",
				],
				"render",
			),
		).toStrictEqual(["get_deploy", "list_services"]);
	});
});

describe("resolveToolPermission", () => {
	it("returns no rule when nothing matches", () => {
		expect(resolveToolPermission({allow: ["mcp__other"]}, "srv", "read")).toStrictEqual({
			behavior: null,
			rule: null,
		});
	});

	it("matches the server-wide rule, the wildcard rule and the tool-specific rule", () => {
		expect([
			resolveToolPermission({allow: ["mcp__srv"]}, "srv", "read"),
			resolveToolPermission({allow: ["mcp__srv__*"]}, "srv", "read"),
			resolveToolPermission({allow: ["mcp__srv__read"]}, "srv", "read"),
			resolveToolPermission({allow: ["mcp__srv__write"]}, "srv", "read"),
			resolveToolPermission({allow: ["mcp__srvx"]}, "srv", "read"),
		]).toStrictEqual([
			{behavior: "allow", rule: "mcp__srv"},
			{behavior: "allow", rule: "mcp__srv__*"},
			{behavior: "allow", rule: "mcp__srv__read"},
			{behavior: null, rule: null},
			{behavior: null, rule: null},
		]);
	});

	it("applies deny over ask over allow regardless of specificity", () => {
		expect([
			resolveToolPermission({allow: ["mcp__srv__read"], ask: ["mcp__srv"], deny: ["mcp__srv__*"]}, "srv", "read"),
			resolveToolPermission({allow: ["mcp__srv__read"], ask: ["mcp__srv"]}, "srv", "read"),
			resolveToolPermission({allow: ["mcp__srv"], deny: ["mcp__srv__read"]}, "srv", "read"),
			resolveToolPermission({allow: ["mcp__srv"], ask: ["mcp__srv__read"]}, "srv", "read"),
		]).toStrictEqual([
			{behavior: "deny", rule: "mcp__srv__*"},
			{behavior: "ask", rule: "mcp__srv"},
			{behavior: "deny", rule: "mcp__srv__read"},
			{behavior: "ask", rule: "mcp__srv__read"},
		]);
	});
});

describe("toolPermissionChoice", () => {
	it("maps rule behaviors to the three segmented choices", () => {
		expect([
			toolPermissionChoice("allow"),
			toolPermissionChoice("ask"),
			toolPermissionChoice(null),
			toolPermissionChoice("deny"),
		]).toStrictEqual(["allow", "ask", "ask", "blocked"]);
	});
});

describe("blanketChoice", () => {
	it("is the shared choice, or custom when members differ", () => {
		expect([
			blanketChoice(["allow", "allow"]),
			blanketChoice(["allow", "blocked"]),
			blanketChoice([]),
		]).toStrictEqual(["allow", "custom", "ask"]);
	});
});

describe("isReadOnlyToolName", () => {
	it("classifies tools by their verbs", () => {
		expect(
			[
				"get_deploy",
				"list_services",
				"gmail_read_message",
				"searchThreads",
				"create_event",
				"delete_from_doc",
				"list_and_delete",
				"browser_click",
			].map((tool) => [tool, isReadOnlyToolName(tool)]),
		).toStrictEqual([
			["get_deploy", true],
			["list_services", true],
			["gmail_read_message", true],
			["searchThreads", true],
			["create_event", false],
			["delete_from_doc", false],
			["list_and_delete", false],
			["browser_click", false],
		]);
	});
});

describe("setToolPermission", () => {
	const tools = ["read", "write"];

	it("adds a tool-specific rule and drops the tool's old rules", () => {
		expect(
			setToolPermission({allow: ["Bash(ls)", "mcp__srv__read"], deny: []}, "srv", tools, "read", "blocked"),
		).toStrictEqual({allow: ["Bash(ls)"], ask: [], deny: ["mcp__srv__read"]});
	});

	it("uses no rule for Needs approval when nothing else applies", () => {
		expect(setToolPermission({allow: ["mcp__srv__read"]}, "srv", tools, "read", "ask")).toStrictEqual({
			allow: [],
			ask: [],
			deny: [],
		});
	});

	it("adds an ask rule to override a server-wide allow", () => {
		expect(setToolPermission({allow: ["mcp__srv__*"]}, "srv", tools, "read", "ask")).toStrictEqual({
			allow: ["mcp__srv__*"],
			ask: ["mcp__srv__read"],
			deny: [],
		});
	});

	it("expands a dominating server-wide rule into per-tool rules", () => {
		expect(setToolPermission({deny: ["mcp__srv"], allow: ["Read"]}, "srv", tools, "read", "allow")).toStrictEqual({
			allow: ["Read", "mcp__srv__read"],
			ask: [],
			deny: ["mcp__srv__write"],
		});
	});

	it("does not duplicate an existing rule", () => {
		expect(
			setToolPermission({allow: ["mcp__srv__read", "mcp__srv__read"]}, "srv", tools, "read", "allow"),
		).toStrictEqual({allow: ["mcp__srv__read"], ask: [], deny: []});
	});
});

describe("mergePermissionRules", () => {
	it("replaces the rule lists, keeps other keys, and omits empty lists that were absent", () => {
		expect(
			mergePermissionRules(
				{
					model: "opus",
					permissions: {allow: ["Read"], deny: ["mcp__srv"], defaultMode: "plan"},
				},
				{allow: ["Read", "mcp__srv__read"], ask: [], deny: []},
			),
		).toStrictEqual({
			model: "opus",
			permissions: {allow: ["Read", "mcp__srv__read"], deny: [], defaultMode: "plan"},
		});
	});

	it("creates the permissions object when settings have none", () => {
		expect(mergePermissionRules({}, {allow: [], ask: [], deny: ["mcp__srv__x"]})).toStrictEqual({
			permissions: {deny: ["mcp__srv__x"]},
		});
	});
});

describe("claudeAiConnectors", () => {
	it("lists claude.ai connectors from tool names and rules with readable names", () => {
		expect(
			claudeAiConnectors([
				"mcp__claude_ai_Gmail__search_threads",
				"mcp__claude_ai_Google_Calendar__list_events",
				"mcp__claude_ai_Gmail__get_thread",
				"mcp__imcp__contacts_search",
			]),
		).toStrictEqual([
			{key: "claude_ai_Gmail", name: "Gmail", tools: ["get_thread", "search_threads"]},
			{key: "claude_ai_Google_Calendar", name: "Google Calendar", tools: ["list_events"]},
		]);
	});
});

describe("connector slugs", () => {
	it("round-trips ids holding paths, dots and colons without dots or slashes", () => {
		const id = "local:/Users/test/my.app:server";
		const slug = toConnectorSlug(id);
		expect({hasUnsafe: /[./:]/.test(slug), back: fromConnectorSlug(slug)}).toStrictEqual({
			hasUnsafe: false,
			back: id,
		});
	});

	it("returns null for a malformed slug", () => {
		expect(fromConnectorSlug("!!")).toBeNull();
	});
});

describe("MCP tool extraction from transcripts", () => {
	const testDir = join(tmpdir(), `claude-mcp-tools-test-${process.pid}`);
	const projectId = "-Users-test-app";
	let appDb: AppDb;

	beforeEach(() => {
		mkdirSync(join(testDir, projectId), {recursive: true});
		appDb = openTestDb();
	});

	afterEach(() => {
		appDb.close();
		rmSync(testDir, {recursive: true, force: true});
	});

	function assistant(uuid: string, names: string[]) {
		return {
			type: "assistant",
			uuid,
			parentUuid: null,
			sessionId: "s",
			timestamp: "2026-09-01T00:00:00.000Z",
			cwd: "/Users/test/app",
			message: {
				role: "assistant",
				content: names.map((name, index) => ({
					type: "tool_use",
					id: `toolu_${uuid}_${index}`,
					name,
					input: {},
				})),
			},
		};
	}

	it("indexes the distinct mcp__ tool_use names across sessions", async () => {
		let mtime = Date.parse("2026-09-01T00:00:00Z");
		const write = (sessionId: string, records: unknown[]) => {
			const path = join(testDir, projectId, `${sessionId}.jsonl`);
			writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
			mtime += 1000;
			utimesSync(path, new Date(mtime), new Date(mtime));
			return path;
		};
		await indexJsonlFile(
			appDb.index,
			write("s1", [
				assistant("a", ["mcp__render__list_services", "Bash"]),
				assistant("b", ["mcp__render__list_services", "mcp__imcp__contacts_search"]),
			]),
			projectId,
		);
		await indexJsonlFile(
			appDb.index,
			write("s2", [assistant("c", ["mcp__render__get_deploy", "Read"])]),
			projectId,
		);

		expect(listMcpToolNames(appDb.index)).toStrictEqual([
			"mcp__imcp__contacts_search",
			"mcp__render__get_deploy",
			"mcp__render__list_services",
		]);

		await indexJsonlFile(appDb.index, write("s2", [assistant("d", ["Read"])]), projectId);

		expect(listMcpToolNames(appDb.index)).toStrictEqual([
			"mcp__imcp__contacts_search",
			"mcp__render__list_services",
		]);
	});
});

describe("readMcpServerDetail", () => {
	let root: string;

	beforeEach(() => {
		root = join(tmpdir(), `claude-mcp-detail-test-${process.pid}`);
		mkdirSync(join(root, "claude"), {recursive: true});
		writeFileSync(
			join(root, ".claude.json"),
			JSON.stringify({
				mcpServers: {
					render: {
						type: "http",
						url: "https://mcp.render.com/mcp",
						headers: {Authorization: "Bearer secret-header-value"},
					},
				},
			}),
		);
		writeFileSync(
			join(root, "claude", "settings.json"),
			JSON.stringify({
				permissions: {
					allow: ["mcp__render__*", "mcp__render__update_service"],
					deny: ["mcp__render__delete_service"],
				},
			}),
		);
	});

	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	it("merges seen tool names with rule-named tools and resolves each tool's state", async () => {
		const detail = await readMcpServerDetail("user:render", {
			claudeDir: join(root, "claude"),
			claudeJsonPath: join(root, ".claude.json"),
			toolNames: ["mcp__render__list_services", "mcp__imcp__contacts_search"],
		});

		expect({
			detail,
			leaked: JSON.stringify(detail).includes("secret-header-value"),
		}).toStrictEqual({
			detail: {
				server: {
					id: "user:render",
					name: "render",
					scope: "user",
					transport: "http",
					urlOrCommand: "https://mcp.render.com/mcp",
					enabled: true,
					envKeys: [],
					headerKeys: ["Authorization"],
					needsAuth: false,
				},
				serverKey: "render",
				tools: [
					{
						name: "delete_service",
						behavior: "deny",
						rule: "mcp__render__delete_service",
						readOnly: false,
					},
					{name: "list_services", behavior: "allow", rule: "mcp__render__*", readOnly: true},
					{
						name: "update_service",
						behavior: "allow",
						rule: "mcp__render__*",
						readOnly: false,
					},
				],
			},
			leaked: false,
		});
	});

	it("returns null for an unknown server id", async () => {
		expect(
			await readMcpServerDetail("user:missing", {
				claudeDir: join(root, "claude"),
				claudeJsonPath: join(root, ".claude.json"),
				toolNames: [],
			}),
		).toBeNull();
	});
});
