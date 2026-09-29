import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { PluginDetail, PluginHookRow } from "../api/customize";
import { type PluginInfo, scanPluginTree } from "../plugins";
import { PluginHooksFileSchema } from "../schemas";
import { listPluginMcpServers } from "./mcp";
import { readJson } from "./skills";

/**
 * The marketplace.json plugin-entry fields the detail page shows. Entries
 * carry many churning keys (source, author, lspServers, …), so callers pick
 * these keys out first and parse that projection strictly.
 */
const MarketplaceEntryProjectionSchema = z.strictObject({
  name: z.string(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  homepage: z.string().optional(),
});
type MarketplaceEntry = z.infer<typeof MarketplaceEntryProjectionSchema>;

const PROJECTED_KEYS = ["name", "category", "tags", "homepage"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readMarketplaceEntry(
  claudeDir: string,
  plugin: PluginInfo,
): Promise<MarketplaceEntry | undefined> {
  const manifest = await readJson(
    join(
      claudeDir,
      "plugins",
      "marketplaces",
      plugin.marketplace,
      ".claude-plugin",
      "marketplace.json",
    ),
  );
  if (!isRecord(manifest) || !Array.isArray(manifest["plugins"])) return undefined;
  const pluginName = plugin.id.slice(0, plugin.id.lastIndexOf("@"));
  for (const entry of manifest["plugins"]) {
    if (!isRecord(entry) || entry["name"] !== pluginName) continue;
    const projection = Object.fromEntries(
      PROJECTED_KEYS.filter((key) => key in entry).map((key) => [key, entry[key]]),
    );
    const parsed = MarketplaceEntryProjectionSchema.safeParse(projection);
    return parsed.success ? parsed.data : undefined;
  }
  return undefined;
}

/**
 * One row per event × matcher group in the plugin's hooks/hooks.json, in file
 * order. A file that fails the strict schema contributes no rows.
 */
async function readPluginHooks(installPath: string): Promise<PluginHookRow[]> {
  const parsed = PluginHooksFileSchema.safeParse(
    await readJson(join(installPath, "hooks", "hooks.json")),
  );
  if (!parsed.success) return [];
  return Object.entries(parsed.data.hooks).flatMap(([event, groups]) =>
    groups.map((group) => ({
      event,
      matcher: group.matcher ?? "",
      handlers: group.hooks.map((hook) => (hook.type === "command" ? hook.command : hook.url)),
    })),
  );
}

export interface ReadPluginDetailOptions {
  /** Defaults to ~/.claude. */
  claudeDir?: string;
}

/**
 * Everything the plugin detail tabs show beyond the list entry: the directory
 * tree, hooks.json rows, .mcp.json servers, and the marketplace's homepage
 * and categories.
 */
export async function readPluginDetail(
  plugin: PluginInfo,
  { claudeDir = join(homedir(), ".claude") }: ReadPluginDetailOptions = {},
): Promise<PluginDetail> {
  const [tree, hooks, connectors, entry] = await Promise.all([
    scanPluginTree(plugin.installPath),
    readPluginHooks(plugin.installPath),
    listPluginMcpServers(plugin, claudeDir),
    readMarketplaceEntry(claudeDir, plugin),
  ]);
  const categories = [
    ...new Set([
      ...(entry?.category === undefined ? [] : [entry.category]),
      ...(entry?.tags ?? []),
    ]),
  ];
  return {
    plugin,
    ...(entry?.homepage === undefined ? {} : { homepage: entry.homepage }),
    categories,
    tree: tree?.children ?? [],
    connectors,
    hooks,
  };
}
