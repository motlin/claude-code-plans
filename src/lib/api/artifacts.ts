import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

const ArtifactSummarySchema = z.strictObject({
  url: z.string(),
  id: z.string(),
  kind: z.enum(["html", "docs"]),
  title: z.string(),
  description: z.string().nullable(),
  sourcePath: z.string().nullable(),
  sourceExists: z.boolean(),
  audience: z.string().nullable(),
  firstSeenAt: z.number(),
  lastPublishedAt: z.number().nullable(),
  publishCount: z.number(),
  sessionId: z.string(),
  projectId: z.string(),
});

export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

export const ArtifactListResponse = z.array(ArtifactSummarySchema);

export const artifactsQueryOptions = queryOptions({
  queryKey: ["artifacts"] as const,
  queryFn: ({ signal }) => apiFetch("/api/artifacts", ArtifactListResponse, { signal }),
  staleTime: 30_000,
});
