import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { SkillOverrideValueSchema } from "../schemas";
import { ApiResponseError, apiFetch } from "./client";
import { FileTreeNodeSchema, PluginInfoSchema } from "./plugins";

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

const PluginHookRowSchema = z.strictObject({
  event: z.string(),
  /** "" when the hook group has no matcher (it fires for every tool / event). */
  matcher: z.string(),
  /** Each handler's command line, or its URL for an http hook. */
  handlers: z.array(z.string()),
});
export type PluginHookRow = z.infer<typeof PluginHookRowSchema>;

export const PluginDetailResponse = z.strictObject({
  plugin: PluginInfoSchema,
  homepage: z.string().optional(),
  /** The marketplace entry's category, then its tags. */
  categories: z.array(z.string()),
  /** Children of the plugin directory, paths relative to it. */
  tree: z.array(FileTreeNodeSchema),
  connectors: z.array(McpServerSummarySchema),
  hooks: z.array(PluginHookRowSchema),
});
export type PluginDetail = z.infer<typeof PluginDetailResponse>;

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

export const customizePluginDetailQueryOptions = (pluginId: string) =>
  queryOptions({
    queryKey: ["customize", "plugins", pluginId] as const,
    queryFn: () =>
      apiFetch(`/api/customize/plugins/${encodeURIComponent(pluginId)}`, PluginDetailResponse),
    staleTime: CUSTOMIZE_STALE_TIME_MS,
  });

/** One file inside an installed plugin's directory, `path` relative to it. */
export const customizePluginFileQueryOptions = (pluginId: string, path: string) =>
  queryOptions({
    queryKey: ["customize", "plugins", pluginId, "file", path] as const,
    queryFn: () =>
      apiFetch(
        `/api/customize/file?${new URLSearchParams({ plugin: pluginId, path }).toString()}`,
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

/**
 * The two settings.json maps the Customize enable switches write, plus the
 * file mtime the next write must present (null when settings.json is absent).
 */
export const SettingsToggleStateSchema = z.strictObject({
  mtimeMs: z.number().nullable(),
  skillOverrides: z.record(z.string(), SkillOverrideValueSchema),
  enabledPlugins: z.record(z.string(), z.boolean()),
});
export type SettingsToggleState = z.infer<typeof SettingsToggleStateSchema>;

/**
 * Plugin skills are not affected by `skillOverrides` (they follow their
 * plugin), so a skill key never carries the `plugin:` prefix.
 */
const SkillToggleSchema = z.strictObject({
  kind: z.literal("skill"),
  name: z
    .string()
    .min(1)
    .refine((name) => !name.includes(":"), "Plugin skills follow their plugin"),
  enabled: z.boolean(),
});

const PluginToggleSchema = z.strictObject({
  kind: z.literal("plugin"),
  id: z.string().regex(/^[^@\s]+@[^@\s]+$/, "Expected <plugin>@<marketplace>"),
  enabled: z.boolean(),
});

const SettingsToggleSchema = z.discriminatedUnion("kind", [SkillToggleSchema, PluginToggleSchema]);
export type SettingsToggle = z.infer<typeof SettingsToggleSchema>;

export const SettingsToggleRequestSchema = z.strictObject({
  expectedMtimeMs: z.number().nullable(),
  toggle: SettingsToggleSchema,
});

const SETTINGS_TOGGLES_URL = "/api/customize/settings-toggles";
export const customizeSettingsTogglesQueryOptions = queryOptions({
  queryKey: ["customize", "settings-toggles"] as const,
  queryFn: () => apiFetch(SETTINGS_TOGGLES_URL, SettingsToggleStateSchema),
  staleTime: CUSTOMIZE_STALE_TIME_MS,
});

/** Whether a skill is on for the switch: anything but "off" (absent means "on"). */
export function isSkillEnabled(state: SettingsToggleState, name: string): boolean {
  return state.skillOverrides[name] !== "off";
}

/** Plugins absent from enabledPlugins are enabled. */
export function isPluginEnabled(state: SettingsToggleState, id: string): boolean {
  return state.enabledPlugins[id] !== false;
}

/** The state a toggle produces, mirroring the server write for optimistic UI. */
function applyToggleToState(
  state: SettingsToggleState,
  toggle: SettingsToggle,
): SettingsToggleState {
  if (toggle.kind === "plugin") {
    return { ...state, enabledPlugins: { ...state.enabledPlugins, [toggle.id]: toggle.enabled } };
  }
  const { [toggle.name]: _previous, ...rest } = state.skillOverrides;
  return {
    ...state,
    skillOverrides: toggle.enabled ? rest : { ...rest, [toggle.name]: "off" },
  };
}

/**
 * Enable/disable a skill or plugin with an optimistic cache update. A 409
 * (settings.json changed since it was read) or any other failure rolls the
 * cache back, refetches, and rethrows for the caller's error toast.
 */
export function useSettingsToggle() {
  const queryClient = useQueryClient();
  const settingsTogglesQueryKey = customizeSettingsTogglesQueryOptions.queryKey;
  return useMutation({
    mutationFn: async (toggle: SettingsToggle) => {
      const current = queryClient.getQueryData(settingsTogglesQueryKey);
      const state = current ?? (await queryClient.fetchQuery(customizeSettingsTogglesQueryOptions));
      return apiFetch(SETTINGS_TOGGLES_URL, SettingsToggleStateSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          SettingsToggleRequestSchema.parse({ expectedMtimeMs: state.mtimeMs, toggle }),
        ),
      });
    },
    onMutate: async (toggle: SettingsToggle) => {
      await queryClient.cancelQueries({ queryKey: settingsTogglesQueryKey });
      const previous = queryClient.getQueryData(settingsTogglesQueryKey);
      if (previous !== undefined) {
        queryClient.setQueryData(settingsTogglesQueryKey, applyToggleToState(previous, toggle));
      }
      return { previous };
    },
    onError: (_error, _toggle, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(settingsTogglesQueryKey, context.previous);
      }
    },
    onSuccess: (state) => {
      queryClient.setQueryData(settingsTogglesQueryKey, state);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["customize"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function isSettingsConflict(error: unknown): boolean {
  return error instanceof ApiResponseError && error.status === 409;
}
