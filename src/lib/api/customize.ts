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
