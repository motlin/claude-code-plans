import { z } from "zod";

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
