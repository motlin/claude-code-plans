// fallow-ignore-file duplicate-export -- each twin keeps its strict original's name so a call site swaps only the import path
/**
 * Lenient runtime twins of the strict schemas in `schemas.ts` (see
 * `toLenient`). Runtime code parses on-disk and hook data with these so a new
 * Claude Code version adding a key or enum value never breaks the app; the
 * strict originals keep catching that drift in the disk-validation tests.
 * `tests/runtime-schema-usage.test.ts` fails when runtime code parses with a
 * strict schema imported from `schemas.ts` instead of one of these.
 */
import {toLenient} from "./lenient-schema";
import {
	AiTitleRecordSchema as StrictAiTitleRecordSchema,
	ApiRequestRecordSchema as StrictApiRequestRecordSchema,
	ApiRequestShapeRecordSchema as StrictApiRequestShapeRecordSchema,
	AttachmentPayloadSchema as StrictAttachmentPayloadSchema,
	AttachmentRecordSchema as StrictAttachmentRecordSchema,
	BridgeSessionRecordSchema as StrictBridgeSessionRecordSchema,
	HistorySuppressionRecordSchema as StrictHistorySuppressionRecordSchema,
	ClaudeJsonMcpSchema as StrictClaudeJsonMcpSchema,
	ClaudeJsonOauthAccountSchema as StrictClaudeJsonOauthAccountSchema,
	ClaudeJsonProjectMcpSchema as StrictClaudeJsonProjectMcpSchema,
	ClaudeSettingsSchema as StrictClaudeSettingsSchema,
	ContextMirrorFileSchema as StrictContextMirrorFileSchema,
	ContextUsageTwinSchema as StrictContextUsageTwinSchema,
	CostStateRecordSchema as StrictCostStateRecordSchema,
	CustomTitleRecordSchema as StrictCustomTitleRecordSchema,
	CustomTitleSidecarSchema as StrictCustomTitleSidecarSchema,
	FileEditToolUseResultSchema as StrictFileEditToolUseResultSchema,
	FileHistorySnapshotSchema as StrictFileHistorySnapshotSchema,
	ForkedFromSchema as StrictForkedFromSchema,
	GitOperationSchema as StrictGitOperationSchema,
	JsonlRecordSchema as StrictJsonlRecordSchema,
	McpConfigSchema as StrictMcpConfigSchema,
	McpNeedsAuthCacheSchema as StrictMcpNeedsAuthCacheSchema,
	McpServersSchema as StrictMcpServersSchema,
	PluginCatalogCacheSchema as StrictPluginCatalogCacheSchema,
	PluginHooksFileSchema as StrictPluginHooksFileSchema,
	PrLinkRecordSchema as StrictPrLinkRecordSchema,
	SessionRegistryFileSchema as StrictSessionRegistryFileSchema,
	SessionsIndexSchema as StrictSessionsIndexSchema,
	TaskFileSchema as StrictTaskFileSchema,
} from "./schemas";

export const AiTitleRecordSchema = /* @__PURE__ */ toLenient(StrictAiTitleRecordSchema);
export const ApiRequestRecordSchema = /* @__PURE__ */ toLenient(StrictApiRequestRecordSchema);
export const ApiRequestShapeRecordSchema = /* @__PURE__ */ toLenient(StrictApiRequestShapeRecordSchema);
export const AttachmentPayloadSchema = /* @__PURE__ */ toLenient(StrictAttachmentPayloadSchema);
export const AttachmentRecordSchema = /* @__PURE__ */ toLenient(StrictAttachmentRecordSchema);
export const BridgeSessionRecordSchema = /* @__PURE__ */ toLenient(StrictBridgeSessionRecordSchema);
export const ClaudeJsonMcpSchema = /* @__PURE__ */ toLenient(StrictClaudeJsonMcpSchema);
export const ClaudeJsonOauthAccountSchema = /* @__PURE__ */ toLenient(StrictClaudeJsonOauthAccountSchema);
export const ClaudeJsonProjectMcpSchema = /* @__PURE__ */ toLenient(StrictClaudeJsonProjectMcpSchema);
export const ClaudeSettingsSchema = /* @__PURE__ */ toLenient(StrictClaudeSettingsSchema);
export const ContextUsageTwinSchema = /* @__PURE__ */ toLenient(StrictContextUsageTwinSchema);
export const ContextMirrorFileSchema = /* @__PURE__ */ toLenient(StrictContextMirrorFileSchema);
export const CostStateRecordSchema = /* @__PURE__ */ toLenient(StrictCostStateRecordSchema);
export const CustomTitleRecordSchema = /* @__PURE__ */ toLenient(StrictCustomTitleRecordSchema);
export const CustomTitleSidecarSchema = /* @__PURE__ */ toLenient(StrictCustomTitleSidecarSchema);
export const FileEditToolUseResultSchema = /* @__PURE__ */ toLenient(StrictFileEditToolUseResultSchema);
export const FileHistorySnapshotSchema = /* @__PURE__ */ toLenient(StrictFileHistorySnapshotSchema);
export const ForkedFromSchema = /* @__PURE__ */ toLenient(StrictForkedFromSchema);
export const GitOperationSchema = /* @__PURE__ */ toLenient(StrictGitOperationSchema);
export const HistorySuppressionRecordSchema = /* @__PURE__ */ toLenient(StrictHistorySuppressionRecordSchema);
export const JsonlRecordSchema = /* @__PURE__ */ toLenient(StrictJsonlRecordSchema);
export const McpConfigSchema = /* @__PURE__ */ toLenient(StrictMcpConfigSchema);
export const McpNeedsAuthCacheSchema = /* @__PURE__ */ toLenient(StrictMcpNeedsAuthCacheSchema);
export const McpServersSchema = /* @__PURE__ */ toLenient(StrictMcpServersSchema);
export const PluginCatalogCacheSchema = /* @__PURE__ */ toLenient(StrictPluginCatalogCacheSchema);
export const PluginHooksFileSchema = /* @__PURE__ */ toLenient(StrictPluginHooksFileSchema);
export const PrLinkRecordSchema = /* @__PURE__ */ toLenient(StrictPrLinkRecordSchema);
export const SessionRegistryFileSchema = /* @__PURE__ */ toLenient(StrictSessionRegistryFileSchema);
export const SessionsIndexSchema = /* @__PURE__ */ toLenient(StrictSessionsIndexSchema);
export const TaskFileSchema = /* @__PURE__ */ toLenient(StrictTaskFileSchema);
