import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

const HomeStatsDaySchema = z.strictObject({
  date: z.string(),
  sessions: z.number(),
  messages: z.number(),
  hourCounts: z.array(z.number()).length(24),
  // Keyed by raw model id.
  tokensByModel: z.record(z.string(), z.number()).nullable(),
});

export const HomeStatsResponse = z.strictObject({
  /** The server's local date, so ranges end on the same day the rows were bucketed by. */
  today: z.string(),
  days: z.array(HomeStatsDaySchema),
});

export type HomeStatsPayload = z.infer<typeof HomeStatsResponse>;

export const homeStatsQueryOptions = queryOptions({
  queryKey: ["home-stats"] as const,
  queryFn: ({ signal }) => apiFetch("/api/home-stats", HomeStatsResponse, { signal }),
  staleTime: 5 * 60 * 1000,
});
