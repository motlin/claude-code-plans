import {z} from "zod";

export const SESSION_ID_PATTERN = /^[a-z0-9-]+$/;

const rateLimitWindowFields =
{
	used_percentage: z.number(),
	resets_at: z.number(),
};

/** CLI 2.1.319+ `spend_limit`: emitted only under LLM-gateway auth, with USD figures when known. */
const spendLimitWindowFields =
{
	...rateLimitWindowFields,
	used_usd: z.number().optional(),
	limit_usd: z.number().optional(),
	period: z.string().optional(),
};

const RateLimitWindowSchema = z.object(rateLimitWindowFields).loose();
const SpendLimitWindowSchema = z.object(spendLimitWindowFields).loose();

/**
 * Lenient at runtime: a window the CLI adds later must not throw the whole snapshot away.
 * The strict twin below is for the disk scan, so schema-sync notices new windows.
 */
const StatuslineRateLimitsSchema = z
	.object(
		{
			five_hour: RateLimitWindowSchema.optional(),
			seven_day: RateLimitWindowSchema.optional(),
			spend_limit: SpendLimitWindowSchema.optional(),
		},
	)
	.loose();

export const StatuslineRateLimitsStrictSchema = z.strictObject(
	{
		five_hour: z.strictObject(rateLimitWindowFields).optional(),
		seven_day: z.strictObject(rateLimitWindowFields).optional(),
		spend_limit: z.strictObject(spendLimitWindowFields).optional(),
	},
);

export const StatuslineSchema = z
	.object(
		{
			model: z
				.object(
					{
						id: z.string().optional(),
						display_name: z.string().optional(),
					},
				)
				.loose()
				.optional(),
			workspace: z
				.object(
					{
						current_dir: z.string().optional(),
					},
				)
				.loose()
				.optional(),
			context_window: z
				.object(
					{
						total_input_tokens: z.number().optional(),
						total_output_tokens: z.number().optional(),
						context_window_size: z.number().optional(),
						current_usage: z
							.strictObject(
								{
									input_tokens: z.number(),
									output_tokens: z.number(),
									cache_creation_input_tokens: z.number(),
									cache_read_input_tokens: z.number(),
								},
							)
							.nullish(),
						used_percentage: z.number().nullish(),
						remaining_percentage: z.number().nullish(),
					},
				)
				.loose()
				.optional(),
			rate_limits: StatuslineRateLimitsSchema.optional(),
			/** The CLI's live fast-mode toggle; true while fast mode is on or cooling down. */
			fast_mode: z.boolean().optional(),
			cost: z
				.object(
					{
						total_cost_usd: z.number().optional(),
						total_duration_ms: z.number().optional(),
						total_lines_added: z.number().optional(),
						total_lines_removed: z.number().optional(),
						total_input_tokens: z.number().optional(),
						total_output_tokens: z.number().optional(),
					},
				)
				.loose()
				.optional(),
		},
	)
	.loose();

export type Statusline = z.infer<typeof StatuslineSchema>;
export const StatuslineResponse = StatuslineSchema.nullable();

export interface SessionMetrics
{
	model: string | null;
	contextRemainingPct: number | null;
	costUsd: number | null;
	linesAdded: number | null;
	linesRemoved: number | null;
	elapsedMs: number | null;
}

const SessionMetricsSchema: z.ZodType<SessionMetrics> = z.object(
	{
		model: z.string().nullable(),
		contextRemainingPct: z.number().nullable(),
		costUsd: z.number().nullable(),
		linesAdded: z.number().nullable(),
		linesRemoved: z.number().nullable(),
		elapsedMs: z.number().nullable(),
	},
);

export const SessionMetricsBatchResponse = z.record(z.string(), SessionMetricsSchema.nullable());

export function toSessionMetrics(statusline: Statusline): SessionMetrics
{
	return {
		model: statusline.model?.display_name ?? null,
		contextRemainingPct: statusline.context_window?.remaining_percentage ?? null,
		costUsd: statusline.cost?.total_cost_usd ?? null,
		linesAdded: statusline.cost?.total_lines_added ?? null,
		linesRemoved: statusline.cost?.total_lines_removed ?? null,
		elapsedMs: statusline.cost?.total_duration_ms ?? null,
	};
}
