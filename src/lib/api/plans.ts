import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch, apiFetchOptional } from "./client";

const PlanLinkSchema = z.object({
  sessionId: z.string(),
  project: z.string(),
  projectName: z.string(),
  sessionTitle: z.string().nullable(),
});
export const PlanLinksResponse = z.array(PlanLinkSchema);

export const PlanDetailResponse = z.object({
  markdown: z.string(),
  mtime: z.string(),
  title: z.string(),
});

const PlanProjectRefSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
});
const PlanListItemSchema = z.object({
  filename: z.string(),
  title: z.string(),
  mtime: z.string(),
  projects: z.array(PlanProjectRefSchema),
});
export const PlanListResponse = z.array(PlanListItemSchema);
export type PlanListItem = z.infer<typeof PlanListItemSchema>;

export const plansQueryOptions = () =>
  queryOptions({
    queryKey: ["plans"] as const,
    queryFn: () => apiFetch("/api/plans", PlanListResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

// `slug` is the plan basename without its `.md` extension. The API route
// re-adds the extension before touching disk; see src/lib/md-slug.ts for why
// the extension is kept out of the URL.
export const planQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["plans", slug] as const,
    queryFn: () => apiFetchOptional(`/api/plans/${encodeURIComponent(slug)}`, PlanDetailResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const planLinksQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["plans", slug, "links"] as const,
    queryFn: () => apiFetch(`/api/plans/${encodeURIComponent(slug)}/links`, PlanLinksResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });
