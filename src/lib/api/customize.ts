import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";
import { FileTreeNodeSchema } from "./plugins";

export const SkillSourceSchema = z.enum(["personal", "project", "plugin"]);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

const SkillSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: SkillSourceSchema,
  sourceLabel: z.string(),
  dir: z.string(),
  mtime: z.number(),
  enabled: z.boolean(),
});
export type SkillSummary = z.infer<typeof SkillSummarySchema>;

export const SkillListResponse = z.array(SkillSummarySchema);

export const SkillDetailResponse = z.strictObject({
  skill: SkillSummarySchema,
  pluginId: z.string().optional(),
  userInvocable: z.boolean(),
  modelInvocable: z.boolean(),
  allowedTools: z.array(z.string()),
  argumentHint: z.string().optional(),
  /** Children of the skill directory, paths relative to it. */
  tree: z.array(FileTreeNodeSchema),
});
export type SkillDetail = z.infer<typeof SkillDetailResponse>;

export const CustomizeFileResponse = z.strictObject({
  path: z.string(),
  content: z.string(),
});

export const McpScopeSchema = z.enum(["user", "local", "project", "plugin"]);
export type McpScope = z.infer<typeof McpScopeSchema>;

const McpServerSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  scope: McpScopeSchema,
  transport: z.string(),
  urlOrCommand: z.string(),
  enabled: z.boolean(),
  projectPath: z.string().optional(),
  envKeys: z.array(z.string()),
  headerKeys: z.array(z.string()),
});
export type McpServerSummary = z.infer<typeof McpServerSummarySchema>;

export const McpServerListResponse = z.array(McpServerSummarySchema);

export const PermissionBehaviorSchema = z.enum(["allow", "ask", "deny"]);

const McpToolPermissionSchema = z.strictObject({
  name: z.string(),
  /** The winning settings.json rule list, or null when no rule names the tool. */
  behavior: PermissionBehaviorSchema.nullable(),
  rule: z.string().nullable(),
  readOnly: z.boolean(),
});
export type McpToolPermission = z.infer<typeof McpToolPermissionSchema>;

export const McpServerDetailResponse = z.strictObject({
  server: McpServerSummarySchema,
  /** The `<server>` segment of `mcp__<server>__<tool>`. */
  serverKey: z.string(),
  tools: z.array(McpToolPermissionSchema),
});
export type McpServerDetail = z.infer<typeof McpServerDetailResponse>;

const ClaudeAiConnectorSchema = z.strictObject({
  key: z.string(),
  name: z.string(),
  tools: z.array(z.string()),
});
export type ClaudeAiConnectorSummary = z.infer<typeof ClaudeAiConnectorSchema>;

export const ClaudeAiConnectorListResponse = z.array(ClaudeAiConnectorSchema);

const CUSTOMIZE_STALE_TIME_MS = 30_000;

export const customizeSkillsQueryOptions = queryOptions({
  queryKey: ["customize", "skills"] as const,
  queryFn: () => apiFetch("/api/customize/skills", SkillListResponse),
  staleTime: CUSTOMIZE_STALE_TIME_MS,
});

export const customizeSkillDetailQueryOptions = (skillId: string) =>
  queryOptions({
    queryKey: ["customize", "skills", skillId] as const,
    queryFn: () =>
      apiFetch(`/api/customize/skills/${encodeURIComponent(skillId)}`, SkillDetailResponse),
    staleTime: CUSTOMIZE_STALE_TIME_MS,
  });

/** One file inside a skill directory, `path` relative to it. */
export const customizeSkillFileQueryOptions = (skillId: string, path: string) =>
  queryOptions({
    queryKey: ["customize", "skills", skillId, "file", path] as const,
    queryFn: () =>
      apiFetch(
        `/api/customize/file?${new URLSearchParams({ skill: skillId, path }).toString()}`,
        CustomizeFileResponse,
      ),
    staleTime: 0,
  });

export const customizeMcpServersQueryOptions = queryOptions({
  queryKey: ["customize", "mcp-servers"] as const,
  queryFn: () => apiFetch("/api/customize/mcp-servers", McpServerListResponse),
  staleTime: CUSTOMIZE_STALE_TIME_MS,
});

export const customizeMcpServerDetailQueryOptions = (serverSlug: string) =>
  queryOptions({
    queryKey: ["customize", "mcp-servers", serverSlug] as const,
    queryFn: () =>
      apiFetch(
        `/api/customize/mcp-servers/${encodeURIComponent(serverSlug)}`,
        McpServerDetailResponse,
      ),
    staleTime: CUSTOMIZE_STALE_TIME_MS,
  });

export const customizeClaudeAiConnectorsQueryOptions = queryOptions({
  queryKey: ["customize", "claude-ai-connectors"] as const,
  queryFn: () => apiFetch("/api/customize/claude-ai-connectors", ClaudeAiConnectorListResponse),
  staleTime: CUSTOMIZE_STALE_TIME_MS,
});
