import { z } from "zod";

export const SESSION_ID_PATTERN = /^[a-z0-9-]+$/;

export const StatuslineSchema = z
  .object({
    model: z
      .object({
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
        remaining_percentage: z.number().optional(),
      })
      .loose()
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
