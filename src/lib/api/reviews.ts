import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

export const FindingSchema = z
  .object({
    id: z.string(),
    file: z.string(),
    side: z.enum(["old", "new"]),
    line: z.number().int(),
    endLine: z.number().int().optional(),
    severity: z.enum(["high", "medium", "low", "nit"]),
    title: z.string(),
    body: z.string(),
    suggestion: z.string().optional(),
    resolved: z.boolean().default(false),
  })
  .strict();

export const ReviewBundleSchema = z
  .object({
    reviewId: z.string(),
    sessionId: z.string(),
    cwd: z.string(),
    diff: z.string(),
    summary: z.string().nullable(),
    findings: z.array(FindingSchema),
    generatedAt: z.string(),
  })
  .strict();

export type ReviewBundle = z.infer<typeof ReviewBundleSchema>;

export const ReviewIdResponseSchema = z.object({ reviewId: z.string() }).strict();

export const ReviewFindingsRequestSchema = z.object({ findings: z.array(FindingSchema) }).strict();

export const ReviewErrorResponseSchema = z.object({ error: z.string() }).strict();
const ReviewCancelResponseSchema = z.object({ ok: z.boolean() }).strict();

export async function createWorkingCopyReview(sessionId: string): Promise<string> {
  const result = await apiFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/review`,
    ReviewIdResponseSchema,
    { method: "POST" },
  );
  return result.reviewId;
}

export async function runWorkingCopyReview(reviewId: string): Promise<{
  processId: string;
  completion: Promise<string>;
}> {
  const url = `/api/reviews/${encodeURIComponent(reviewId)}/run`;
  const response = await fetch(url, { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${response.statusText}`);
  const processId = response.headers.get("X-Process-Id");
  if (processId === null) throw new Error("Review runner did not return a process id");
  return { processId, completion: response.text() };
}

export async function cancelWorkingCopyReview(
  reviewId: string,
  processId: string,
): Promise<boolean> {
  const result = await apiFetch(
    `/api/reviews/${encodeURIComponent(reviewId)}/run`,
    ReviewCancelResponseSchema,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", processId }),
    },
  );
  return result.ok;
}

export const reviewQueryOptions = (reviewId: string) =>
  queryOptions({
    queryKey: ["reviews", reviewId] as const,
    queryFn: () => apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}`, ReviewBundleSchema),
    staleTime: Infinity,
    gcTime: Infinity,
  });
