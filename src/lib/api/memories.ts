import { z } from "zod";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

const MemoryListItemSchema = z.object({
  filename: z.string(),
  title: z.string(),
  mtime: z.string(),
  project: z.string(),
});
export type MemoryListItem = z.infer<typeof MemoryListItemSchema>;

const ProjectScopeSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectPath: z.string().nullable(),
});

export const MemoryListResponse = z
  .object({
    project: ProjectScopeSchema,
    memories: z.array(MemoryListItemSchema),
  })
  .nullable();

export const MemoryDetailResponse = z
  .object({
    markdown: z.string(),
    mtime: z.string().nullable(),
    projectName: z.string(),
  })
  .nullable();

export const projectMemoriesQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["projects", id, "memories"] as const,
    queryFn: () => apiFetch(`/api/projects/${encodeURIComponent(id)}/memories`, MemoryListResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

// `slug` is the memory basename without its `.md` extension. The API route
// re-adds the extension before touching disk; see src/lib/md-slug.ts for why
// the extension is kept out of the URL.
export const memoryDetailQueryOptions = (project: string, slug: string) =>
  queryOptions({
    queryKey: ["projects", project, "memories", slug] as const,
    queryFn: () =>
      apiFetch(
        `/api/projects/${encodeURIComponent(project)}/memories/${encodeURIComponent(slug)}`,
        MemoryDetailResponse,
      ),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const MemorySaveResponse = z.object({ ok: z.boolean() });
export const MemoryDeleteResponse = z.object({ ok: z.boolean() });

export const useSaveMemory = (project: string, slug: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch(
        `/api/projects/${encodeURIComponent(project)}/memories/${encodeURIComponent(slug)}`,
        MemorySaveResponse,
        {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: content,
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["projects", project, "memories"],
      });
      void qc.invalidateQueries({
        queryKey: ["projects", project, "memories", slug],
      });
    },
  });
};

export const useRemoveMemory = (project: string, slug: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/projects/${encodeURIComponent(project)}/memories/${encodeURIComponent(slug)}`,
        MemoryDeleteResponse,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["projects", project, "memories"],
      });
    },
  });
};
