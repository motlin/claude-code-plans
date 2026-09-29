import { z } from "zod";

export const SESSION_ID_PATTERN = /^[a-z0-9-]+$/;

const RateLimitWindowSchema = z.strictObject({
  used_percentage: z.number(),
  resets_at: z.number(),
});

export const StatuslineSchema = z
  .object({
    model: z
      .object({
        id: z.string().optional(),
        display_name: z.string().optional(),
      })
      .loose()
      .optional(),
    workspace: z
      .object({
        current_dir: z.string().optional(),
      })
      .loose()
      .optional(),
    context_window: z
      .object({
        total_input_tokens: z.number().optional(),
        total_output_tokens: z.number().optional(),
        context_window_size: z.number().optional(),
        current_usage: z
          .strictObject({
            input_tokens: z.number(),
            output_tokens: z.number(),
            cache_creation_input_tokens: z.number(),
            cache_read_input_tokens: z.number(),
          })
          .nullish(),
        used_percentage: z.number().nullish(),
        remaining_percentage: z.number().nullish(),
      })
      .loose()
      .optional(),
    rate_limits: z
      .strictObject({
        five_hour: RateLimitWindowSchema.optional(),
        seven_day: RateLimitWindowSchema.optional(),
      })
      .optional(),
    cost: z
      .object({
        total_cost_usd: z.number().optional(),
        total_duration_ms: z.number().optional(),
        total_lines_added: z.number().optional(),
        total_lines_removed: z.number().optional(),
        total_input_tokens: z.number().optional(),
        total_output_tokens: z.number().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type Statusline = z.infer<typeof StatuslineSchema>;
export const StatuslineResponse = StatuslineSchema.nullable();

export interface SessionMetrics {
  model: string | null;
  contextRemainingPct: number | null;
  costUsd: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  elapsedMs: number | null;
}

const SessionMetricsSchema: z.ZodType<SessionMetrics> = z.object({
  model: z.string().nullable(),
  contextRemainingPct: z.number().nullable(),
  costUsd: z.number().nullable(),
  linesAdded: z.number().nullable(),
  linesRemoved: z.number().nullable(),
  elapsedMs: z.number().nullable(),
});

export const SessionMetricsBatchResponse = z.record(z.string(), SessionMetricsSchema.nullable());

export function toSessionMetrics(statusline: Statusline): SessionMetrics {
  return {
    model: statusline.model?.display_name ?? null,
    contextRemainingPct: statusline.context_window?.remaining_percentage ?? null,
    costUsd: statusline.cost?.total_cost_usd ?? null,
    linesAdded: statusline.cost?.total_lines_added ?? null,
    linesRemoved: statusline.cost?.total_lines_removed ?? null,
    elapsedMs: statusline.cost?.total_duration_ms ?? null,
  };
}
