import { homedir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import type { McpScope, McpServerSummary } from "../api/customize";
import {
  ClaudeJsonMcpSchema,
  ClaudeJsonProjectMcpSchema,
  ClaudeSettingsSchema,
  McpConfigSchema,
  McpServersSchema,
} from "../schemas";
import { readInstalledPlugins, readJson } from "./skills";

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
  projects: { path: string; mcp: ProjectMcp }[];
}

async function readClaudeJson(path: string): Promise<ClaudeJsonMcp> {
  const raw = await readJson(path);
  if (!isRecord(raw)) return { mcpServers: {}, projects: [] };

  const top = ClaudeJsonMcpSchema.safeParse(pick(raw, ["mcpServers"]));
  const projects: ClaudeJsonMcp["projects"] = [];
  if (isRecord(raw["projects"])) {
    for (const [projectPath, entry] of Object.entries(raw["projects"])) {
      if (!isRecord(entry)) continue;
      const parsed = ClaudeJsonProjectMcpSchema.safeParse(pick(entry, PROJECT_MCP_KEYS));
      if (parsed.success) projects.push({ path: projectPath, mcp: parsed.data });
    }
  }
  projects.sort((a, b) => a.path.localeCompare(b.path));
  return { mcpServers: top.success ? (top.data.mcpServers ?? {}) : {}, projects };
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
  const settingsParsed = ClaudeSettingsSchema.safeParse(
    await readJson(join(claudeDir, "settings.json")),
  );
  const settings = settingsParsed.success ? settingsParsed.data : {};

  const result: McpServerSummary[] = [];

  for (const [name, entry] of sortedEntries(claudeJson.mcpServers)) {
    result.push(summarize(name, entry, "user", "user:", true));
  }

  for (const { path, mcp } of claudeJson.projects) {
    const disabled = new Set(mcp.disabledMcpServers ?? []);
    for (const [name, entry] of sortedEntries(mcp.mcpServers ?? {})) {
      result.push(summarize(name, entry, "local", `local:${path}:`, !disabled.has(name), path));
    }
  }

  for (const { path, mcp } of claudeJson.projects) {
    const parsed = McpConfigSchema.safeParse(await readJson(join(path, ".mcp.json")));
    if (!parsed.success) continue;
    const disabled = new Set([
      ...(mcp.disabledMcpServers ?? []),
      ...(mcp.disabledMcpjsonServers ?? []),
    ]);
    const approved = new Set([
      ...(mcp.enabledMcpjsonServers ?? []),
      ...(settings.enabledMcpjsonServers ?? []),
    ]);
    for (const [name, entry] of sortedEntries(parsed.data.mcpServers)) {
      const enabled =
        !disabled.has(name) && (settings.enableAllProjectMcpServers === true || approved.has(name));
      result.push(summarize(name, entry, "project", `project:${path}:`, enabled, path));
    }
  }

  for (const plugin of await readInstalledPlugins(claudeDir)) {
    const enabled = settings.enabledPlugins?.[plugin.id] === true;
    for (const [name, entry] of sortedEntries(await readPluginServers(plugin.installPath))) {
      result.push(summarize(name, entry, "plugin", `plugin:${plugin.id}:`, enabled));
    }
  }

  return result;
}
