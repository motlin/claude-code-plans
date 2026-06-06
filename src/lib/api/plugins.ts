import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const PluginFileSchema = z.object({
  filename: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.enum(["agent", "command", "skill", "reference", "example"]),
  frontmatter: z.record(z.string(), z.string()),
});

const PluginSkillSchema = z.object({
  dirname: z.string(),
  name: z.string(),
  description: z.string(),
  skillFile: PluginFileSchema,
  references: z.array(PluginFileSchema),
  examples: z.array(PluginFileSchema),
});

const PluginInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  marketplace: z.string(),
  installPath: z.string(),
  agents: z.array(PluginFileSchema),
  commands: z.array(PluginFileSchema),
  skills: z.array(PluginSkillSchema),
});
export type PluginInfoData = z.infer<typeof PluginInfoSchema>;

export const PluginListResponse = z.array(PluginInfoSchema);
export type PluginListData = z.infer<typeof PluginListResponse>;

const UserCommandGroupSchema = z.object({
  source: z.string(),
  sourceName: z.string(),
  commands: z.array(PluginFileSchema),
});
export type UserCommandGroupData = z.infer<typeof UserCommandGroupSchema>;

export const UserCommandListResponse = z.array(UserCommandGroupSchema);

export interface FileTreeNodeData {
  path: string;
  children?: FileTreeNodeData[] | undefined;
}
const FileTreeNodeSchema: z.ZodType<FileTreeNodeData> = z.lazy(() =>
  z.object({
    path: z.string(),
    children: z.array(FileTreeNodeSchema).optional(),
  }),
);
export const PluginTreeResponse = FileTreeNodeSchema.nullable();

export const PluginFileResponse = z
  .object({
    markdown: z.string(),
    title: z.string(),
    frontmatter: z.record(z.string(), z.string()),
  })
  .nullable();

export const UserCommandFileResponse = z
  .object({
    markdown: z.string(),
    title: z.string(),
    sourceName: z.string(),
  })
  .nullable();

export type PluginMarketplaceGroup = {
  marketplace: { id: string; displayName: string };
  plugins: PluginInfoData[];
  isOfficial: boolean;
};

function isOfficialMarketplace(marketplaceId: string): boolean {
  return marketplaceId === "claude-plugins-official" || marketplaceId === "anthropic-agent-skills";
}

function formatMarketplaceName(id: string): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Group a flat plugin list by marketplace id and decorate with `isOfficial`.
 * Server returns the flat list; presentation-time grouping happens here.
 */
export function groupPluginsByMarketplace(plugins: PluginListData): PluginMarketplaceGroup[] {
  const groups = new Map<string, PluginMarketplaceGroup>();

  for (const plugin of plugins) {
    const marketplaceId = plugin.marketplace;
    let group = groups.get(marketplaceId);
    if (!group) {
      group = {
        marketplace: {
          id: marketplaceId,
          displayName: formatMarketplaceName(marketplaceId),
        },
        plugins: [],
        isOfficial: isOfficialMarketplace(marketplaceId),
      };
      groups.set(marketplaceId, group);
    }
    group.plugins.push(plugin);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.isOfficial !== b.isOfficial) return a.isOfficial ? -1 : 1;
    return a.marketplace.displayName.localeCompare(b.marketplace.displayName);
  });
}

const PLUGINS_STALE_TIME_MS = 30_000;

export const pluginsQueryOptions = queryOptions({
  queryKey: ["plugins"] as const,
  queryFn: () => apiFetch("/api/plugins", PluginListResponse),
  staleTime: PLUGINS_STALE_TIME_MS,
});

export const userCommandsQueryOptions = queryOptions({
  queryKey: ["plugins", "user-commands"] as const,
  queryFn: () => apiFetch("/api/plugins/user-commands", UserCommandListResponse),
  staleTime: PLUGINS_STALE_TIME_MS,
});

export const pluginTreeQueryOptions = (pluginId: string) =>
  queryOptions({
    queryKey: ["plugins", pluginId, "tree"] as const,
    queryFn: () =>
      apiFetch(`/api/plugins/${encodeURIComponent(pluginId)}/tree`, PluginTreeResponse),
    staleTime: PLUGINS_STALE_TIME_MS,
  });

export const pluginFileQueryOptions = (pluginId: string, pathSegments: ReadonlyArray<string>) =>
  queryOptions({
    queryKey: ["plugins", pluginId, "file", ...pathSegments] as const,
    queryFn: () =>
      apiFetch(
        `/api/plugins/${encodeURIComponent(pluginId)}/files/${pathSegments.map(encodeURIComponent).join("/")}`,
        PluginFileResponse,
      ),
    staleTime: PLUGINS_STALE_TIME_MS,
  });

export const userCommandFileQueryOptions = (source: string, filename: string) =>
  queryOptions({
    queryKey: ["plugins", "user-commands", source, filename] as const,
    queryFn: () =>
      apiFetch(
        `/api/plugins/user-commands/${encodeURIComponent(source)}/${encodeURIComponent(filename)}`,
        UserCommandFileResponse,
      ),
    staleTime: PLUGINS_STALE_TIME_MS,
  });
