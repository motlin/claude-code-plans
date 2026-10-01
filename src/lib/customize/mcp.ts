import {homedir} from "node:os";
import {join} from "node:path";
import type {z} from "zod";
import type {ClaudeAiConnectorSummary, McpScope, McpServerDetail, McpServerSummary} from "../api/customize";
import {
	ClaudeJsonMcpSchema,
	ClaudeJsonProjectMcpSchema,
	ClaudeSettingsSchema,
	McpConfigSchema,
	McpNeedsAuthCacheSchema,
	McpServersSchema,
} from "../schemas";
import {
	claudeAiConnectors,
	isReadOnlyToolName,
	mcpServerKey,
	mcpToolsForServer,
	type PermissionRules,
	resolveToolPermission,
} from "./mcp-tool-permissions";
import {readInstalledPlugins, readJson} from "./skills";

type McpServers = z.infer<typeof McpServersSchema>;
type McpServerEntry = McpServers[string];
type ProjectMcp = z.infer<typeof ClaudeJsonProjectMcpSchema>;

const PROJECT_MCP_KEYS = [
	"mcpServers",
	"disabledMcpServers",
	"enabledMcpjsonServers",
	"disabledMcpjsonServers",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of keys) {
		if (key in value) out[key] = value[key];
	}
	return out;
}

interface ClaudeJsonMcp {
	mcpServers: McpServers;
	projects: {path: string; mcp: ProjectMcp}[];
}

async function readClaudeJson(path: string): Promise<ClaudeJsonMcp> {
	const raw = await readJson(path);
	if (!isRecord(raw)) return {mcpServers: {}, projects: []};

	const top = ClaudeJsonMcpSchema.safeParse(pick(raw, ["mcpServers"]));
	const projects: ClaudeJsonMcp["projects"] = [];
	if (isRecord(raw["projects"])) {
		for (const [projectPath, entry] of Object.entries(raw["projects"])) {
			if (!isRecord(entry)) continue;
			const parsed = ClaudeJsonProjectMcpSchema.safeParse(pick(entry, PROJECT_MCP_KEYS));
			if (parsed.success) projects.push({path: projectPath, mcp: parsed.data});
		}
	}
	projects.sort((a, b) => a.path.localeCompare(b.path));
	return {mcpServers: top.success ? (top.data.mcpServers ?? {}) : {}, projects};
}

function sortedEntries(servers: McpServers): [string, McpServerEntry][] {
	return Object.entries(servers).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Summarises one server entry. Only the key names of `env` and `headers` are
 * kept: their values routinely hold API tokens and must never leave the server.
 */
function summarize(
	name: string,
	entry: McpServerEntry,
	scope: McpScope,
	idPrefix: string,
	enabled: boolean,
	needsAuth: boolean,
	projectPath?: string,
): McpServerSummary {
	const command = [entry.command ?? "", ...(entry.args ?? [])].join(" ").trim();
	const summary: McpServerSummary = {
		id: `${idPrefix}${name}`,
		name,
		scope,
		transport: entry.type ?? (entry.url === undefined ? "stdio" : "http"),
		urlOrCommand: entry.url ?? command,
		enabled,
		envKeys: Object.keys(entry.env ?? {}).sort(),
		headerKeys: Object.keys(entry.headers ?? {}).sort(),
		needsAuth,
	};
	if (projectPath !== undefined) summary.projectPath = projectPath;
	return summary;
}

/** A plugin's .mcp.json is either `{ mcpServers: {...} }` or the bare server map. */
async function readPluginServers(installPath: string): Promise<McpServers> {
	const raw = await readJson(join(installPath, ".mcp.json"));
	const wrapped = McpConfigSchema.safeParse(raw);
	if (wrapped.success) return wrapped.data.mcpServers;
	const bare = McpServersSchema.safeParse(raw);
	return bare.success ? bare.data : {};
}

type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>;

/** The server names the CLI last found needing authentication; empty when the cache is absent or malformed. */
async function readNeedsAuth(claudeDir: string): Promise<ReadonlySet<string>> {
	const parsed = McpNeedsAuthCacheSchema.safeParse(await readJson(join(claudeDir, "mcp-needs-auth-cache.json")));
	return new Set(parsed.success ? Object.keys(parsed.data) : []);
}

/** The CLI names plugin servers `plugin:<plugin name>:<server>`, without the marketplace. */
function pluginServerKey(pluginId: string, name: string): string {
	return `plugin:${pluginId.split("@")[0] ?? pluginId}:${name}`;
}

async function readSettings(claudeDir: string): Promise<ClaudeSettings> {
	const parsed = ClaudeSettingsSchema.safeParse(await readJson(join(claudeDir, "settings.json")));
	return parsed.success ? parsed.data : {};
}

export interface ListMcpServersOptions {
	/** Defaults to ~/.claude. */
	claudeDir?: string;
	/** Defaults to ~/.claude.json. */
	claudeJsonPath?: string;
}

/**
 * Every MCP server Claude Code can load, grouped by scope: user
 * (~/.claude.json mcpServers), local (~/.claude.json projects[path].mcpServers),
 * project (<path>/.mcp.json for each project known to ~/.claude.json), and
 * installed-plugin .mcp.json files.
 *
 * `enabled` follows the CLI: local servers are off when listed in the project's
 * disabledMcpServers; project servers need approval (enableAllProjectMcpServers
 * or enabledMcpjsonServers) and are off when rejected; plugin servers follow
 * settings.enabledPlugins.
 */
export async function listMcpServers({
	claudeDir = join(homedir(), ".claude"),
	claudeJsonPath = join(homedir(), ".claude.json"),
}: ListMcpServersOptions = {}): Promise<McpServerSummary[]> {
	const claudeJson = await readClaudeJson(claudeJsonPath);
	const settings = await readSettings(claudeDir);
	const needsAuth = await readNeedsAuth(claudeDir);

	const result: McpServerSummary[] = [];

	for (const [name, entry] of sortedEntries(claudeJson.mcpServers)) {
		result.push(summarize(name, entry, "user", "user:", true, needsAuth.has(name)));
	}

	for (const {path, mcp} of claudeJson.projects) {
		const disabled = new Set(mcp.disabledMcpServers ?? []);
		for (const [name, entry] of sortedEntries(mcp.mcpServers ?? {})) {
			result.push(
				summarize(name, entry, "local", `local:${path}:`, !disabled.has(name), needsAuth.has(name), path),
			);
		}
	}

	for (const {path, mcp} of claudeJson.projects) {
		const parsed = McpConfigSchema.safeParse(await readJson(join(path, ".mcp.json")));
		if (!parsed.success) continue;
		const disabled = new Set([...(mcp.disabledMcpServers ?? []), ...(mcp.disabledMcpjsonServers ?? [])]);
		const approved = new Set([...(mcp.enabledMcpjsonServers ?? []), ...(settings.enabledMcpjsonServers ?? [])]);
		for (const [name, entry] of sortedEntries(parsed.data.mcpServers)) {
			const enabled = !disabled.has(name) && (settings.enableAllProjectMcpServers === true || approved.has(name));
			result.push(summarize(name, entry, "project", `project:${path}:`, enabled, needsAuth.has(name), path));
		}
	}

	for (const plugin of await readInstalledPlugins(claudeDir)) {
		result.push(...(await pluginServers(plugin, settings, needsAuth)));
	}

	return result;
}

async function pluginServers(
	plugin: {id: string; installPath: string},
	settings: ClaudeSettings,
	needsAuth: ReadonlySet<string>,
): Promise<McpServerSummary[]> {
	const enabled = settings.enabledPlugins?.[plugin.id] === true;
	return sortedEntries(await readPluginServers(plugin.installPath)).map(([name, entry]) =>
		summarize(
			name,
			entry,
			"plugin",
			`plugin:${plugin.id}:`,
			enabled,
			needsAuth.has(pluginServerKey(plugin.id, name)),
		),
	);
}

/** The servers one installed plugin's .mcp.json declares, as listed under Connectors. */
export async function listPluginMcpServers(
	plugin: {id: string; installPath: string},
	claudeDir: string = join(homedir(), ".claude"),
): Promise<McpServerSummary[]> {
	return pluginServers(plugin, await readSettings(claudeDir), await readNeedsAuth(claudeDir));
}

export interface McpToolOptions extends ListMcpServersOptions {
	/** Every `mcp__…` tool name seen in indexed transcripts. */
	toolNames: readonly string[];
}

function permissionRuleNames(rules: PermissionRules): string[] {
	return [...(rules.allow ?? []), ...(rules.ask ?? []), ...(rules.deny ?? [])];
}

/**
 * One server plus the permission state of each of its tools. Tools are the
 * names seen in transcripts together with any named by a settings.json rule;
 * state comes from ~/.claude/settings.json permissions (deny > ask > allow).
 */
export async function readMcpServerDetail(
	id: string,
	{toolNames, ...options}: McpToolOptions,
): Promise<McpServerDetail | null> {
	const server = (await listMcpServers(options)).find((candidate) => candidate.id === id);
	if (server === undefined) return null;
	const claudeDir = options.claudeDir ?? join(homedir(), ".claude");
	const rules: PermissionRules = (await readSettings(claudeDir)).permissions ?? {};
	const serverKey = mcpServerKey(server);
	const tools = mcpToolsForServer([...toolNames, ...permissionRuleNames(rules)], serverKey).map((name) => ({
		name,
		...resolveToolPermission(rules, serverKey, name),
		readOnly: isReadOnlyToolName(name),
	}));
	return {server, serverKey, tools};
}

/** claude.ai connectors seen in transcripts or permission rules; managed in the cloud. */
export async function listClaudeAiConnectors({
	toolNames,
	claudeDir = join(homedir(), ".claude"),
}: McpToolOptions): Promise<ClaudeAiConnectorSummary[]> {
	const rules: PermissionRules = (await readSettings(claudeDir)).permissions ?? {};
	return claudeAiConnectors([...toolNames, ...permissionRuleNames(rules)]);
}
