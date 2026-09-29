import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import type { DiscoverCatalog, DiscoverPlugin } from "../api/customize";
import { PluginCatalogCacheSchema } from "../schemas";
import { readInstalledPlugins, readJson } from "./skills";

/**
 * The marketplace.json plugin-entry fields Discover shows. Entries carry many
 * churning keys (source, lspServers, …), so the reader picks these keys out
 * first and parses that projection strictly.
 */
const ManifestEntryProjectionSchema = z.strictObject({
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  author: z.strictObject({ name: z.string() }).optional(),
  category: z.string().optional(),
  skills: z.array(z.string()).optional(),
});

const PROJECTED_KEYS = ["name", "displayName", "description", "author", "category", "skills"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function project(entry: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of PROJECTED_KEYS) {
    if (!(key in entry)) continue;
    const value = entry[key];
    picked[key] = key === "author" && isRecord(value) ? { name: value["name"] } : value;
  }
  return picked;
}

async function readCatalogCache(claudeDir: string) {
  const parsed = PluginCatalogCacheSchema.safeParse(
    await readJson(join(claudeDir, "plugins", "plugin-catalog-cache.json")),
  );
  return parsed.success ? parsed.data : undefined;
}

async function readManifestPlugins(
  claudeDir: string,
): Promise<{ marketplace: string; entry: z.infer<typeof ManifestEntryProjectionSchema> }[]> {
  const root = join(claudeDir, "plugins", "marketplaces");
  let marketplaces: string[];
  try {
    marketplaces = (await readdir(root)).sort();
  } catch {
    return [];
  }
  const manifests = await Promise.all(
    marketplaces.map(async (marketplace) => ({
      marketplace,
      manifest: await readJson(join(root, marketplace, ".claude-plugin", "marketplace.json")),
    })),
  );
  return manifests.flatMap(({ marketplace, manifest }) => {
    if (!isRecord(manifest) || !Array.isArray(manifest["plugins"])) return [];
    return manifest["plugins"].flatMap((entry: unknown) => {
      if (!isRecord(entry)) return [];
      const parsed = ManifestEntryProjectionSchema.safeParse(project(entry));
      return parsed.success ? [{ marketplace, entry: parsed.data }] : [];
    });
  });
}

export interface ReadDiscoverCatalogOptions {
  /** Defaults to ~/.claude. */
  claudeDir?: string;
}

/**
 * Every plugin Discover can offer: the official catalog cache (with install
 * counts) first, then marketplace manifest entries the catalog does not
 * cover. `installed` marks plugins already in installed_plugins.json.
 */
export async function readDiscoverCatalog({
  claudeDir = join(homedir(), ".claude"),
}: ReadDiscoverCatalogOptions = {}): Promise<DiscoverCatalog> {
  const [cache, manifestPlugins, installedPlugins] = await Promise.all([
    readCatalogCache(claudeDir),
    readManifestPlugins(claudeDir),
    readInstalledPlugins(claudeDir),
  ]);
  const installed = new Set(installedPlugins.map((plugin) => plugin.id));

  const plugins: DiscoverPlugin[] = Object.entries(cache?.catalog.plugins ?? {}).map(
    ([id, entry]) => {
      const manifest = entry.marketplace_entry;
      return {
        id,
        name: manifest.name,
        title: manifest.displayName ?? manifest.name,
        marketplace: id.slice(id.lastIndexOf("@") + 1),
        description: manifest.description,
        author: manifest.author?.name ?? null,
        category: manifest.category ?? null,
        installs: entry.unique_installs ?? null,
        lastUpdated: entry.last_updated,
        skills: entry.components.skills.map((skill) => skill.name),
        installed: installed.has(id),
      };
    },
  );

  const seen = new Set(plugins.map((plugin) => plugin.id));
  for (const { marketplace, entry } of manifestPlugins) {
    const id = `${entry.name}@${marketplace}`;
    if (seen.has(id)) continue;
    seen.add(id);
    plugins.push({
      id,
      name: entry.name,
      title: entry.displayName ?? entry.name,
      marketplace,
      description: entry.description ?? "",
      author: entry.author?.name ?? null,
      category: entry.category ?? null,
      installs: null,
      lastUpdated: null,
      skills: (entry.skills ?? []).map((path) => basename(path)),
      installed: installed.has(id),
    });
  }

  return { fetchedAt: cache?.fetchedAt ?? null, plugins };
}
