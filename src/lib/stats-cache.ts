import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { StatsCacheTokens } from "./home-stats";

const ModelUsageSchema = z.strictObject({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadInputTokens: z.number().optional(),
  cacheCreationInputTokens: z.number().optional(),
  webSearchRequests: z.number().optional(),
  costUSD: z.number().optional(),
  contextWindow: z.number().optional(),
  maxOutputTokens: z.number().optional(),
});

/** `~/.claude/stats-cache.json`, the CLI's `/stats` cache. */
const StatsCacheSchema = z.strictObject({
  version: z.number(),
  lastComputedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dailyActivity: z.array(
    z.strictObject({
      date: z.string(),
      messageCount: z.number(),
      sessionCount: z.number(),
      toolCallCount: z.number(),
    }),
  ),
  // Keyed by raw model id.
  dailyModelTokens: z.array(
    z.strictObject({ date: z.string(), tokensByModel: z.record(z.string(), z.number()) }),
  ),
  // Keyed by raw model id.
  modelUsage: z.record(z.string(), ModelUsageSchema),
  totalSessions: z.number(),
  totalMessages: z.number(),
  longestSession: z
    .strictObject({
      sessionId: z.string(),
      duration: z.number(),
      messageCount: z.number(),
      timestamp: z.string(),
    })
    .optional(),
  firstSessionDate: z.string().optional(),
  // Keyed by local hour "0".."23".
  hourCounts: z.record(z.string(), z.number()),
  totalSpeculationTimeSavedMs: z.number().optional(),
});

/** The stats cache's per-day token totals, or null when the file is missing or unreadable. */
export async function readStatsCacheTokens(
  claudeDir: string = join(homedir(), ".claude"),
): Promise<StatsCacheTokens | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(claudeDir, "stats-cache.json"), "utf8"));
  } catch {
    return null;
  }
  const result = StatsCacheSchema.safeParse(raw);
  if (!result.success) return null;
  return {
    lastComputedDate: result.data.lastComputedDate,
    dailyModelTokens: result.data.dailyModelTokens,
  };
}
