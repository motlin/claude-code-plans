import { z } from "zod";
import {
  queryOptions,
  infiniteQueryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./client";
import { JsonValueSchema } from "../schemas";
import { SessionViewedStateSchema } from "./viewed-state";

const SessionListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  mtime: z.string(),
  created: z.string(),
  project: z.string(),
  projectName: z.string(),
  messageCount: z.number(),
  gitBranch: z.string().optional(),
  starred: z.boolean(),
  state: z.enum(["idle", "working", "waiting", "unknown"]),
  blockedSince: z.string().nullable(),
});
export type SessionListItem = z.infer<typeof SessionListItemSchema>;
/** Paginated, mtime-desc feed of recent sessions across all projects. */
export const RecentSessionsResponse = z.object({
  sessions: z.array(SessionListItemSchema),
  nextCursor: z.string().nullable(),
});

/** Sessions grouped by project, each capped to a preview slice with a total count. */
const SessionGroupSummarySchema = z.object({
  project: z.string(),
  projectName: z.string(),
  sessionCount: z.number(),
  sessions: z.array(SessionListItemSchema),
});
export const GroupedSessionsResponse = z.array(SessionGroupSummarySchema);

export const StarredSessionsResponse = z.array(SessionListItemSchema);

export const SessionTitlesResponse = z.object({
  titles: z.record(z.string(), z.string()),
});

const ActiveSessionSchema = z.object({
  sessionId: z.string(),
  projectDir: z.string(),
  projectName: z.string(),
  lastModified: z.number(),
});
export const ActiveSessionListResponse = z.array(ActiveSessionSchema);

export const SessionDetailResponse = z
  .object({
    title: z.string(),
    projectName: z.string(),
    projectId: z.string(),
    homeRoot: z.string(),
    imageRoots: z.array(z.string()),
    starred: z.boolean(),
    summary: z.string().nullable(),
    projectPath: z.string().nullable(),
    gitBranch: z.string().nullable(),
    cwd: z.string().nullable(),
    gitSha: z.string().nullable(),
    gitClean: z.boolean().nullable(),
    messageCount: z.number(),
    pendingTaskCount: z.number(),
    viewedState: SessionViewedStateSchema,
    parentSessionId: z.string().optional(),
    entrypoint: z.string().optional(),
    sessionKind: z.string().optional(),
    teamNames: z.array(z.string()).optional(),
    forkedFromSessionId: z.string().optional(),
  })
  .nullable();

export const TranscriptResponse = z.object({
  records: z.array(z.record(z.string(), JsonValueSchema)),
  byteOffset: z.number(),
});
export type TranscriptData = z.infer<typeof TranscriptResponse>;

export const StatuslineResponse = z.record(z.string(), JsonValueSchema).nullable();

const RawJsonlLineSchema = z.object({
  raw: z.string(),
  uuid: z.string().optional(),
  lineIndex: z.number(),
  parseError: z.boolean().optional(),
});

const RawWindowSchema = z.object({
  before: z.array(RawJsonlLineSchema),
  focal: RawJsonlLineSchema,
  after: z.array(RawJsonlLineSchema),
});

const PairedResultSchema = z.object({
  resultEntry: RawJsonlLineSchema,
  resultLineIndex: z.number(),
  toolUseId: z.string(),
});

export const SessionSourceResponse = z
  .object({
    window: RawWindowSchema,
    parsedBlocksJson: z.string(),
    parsedBlocksCount: z.number(),
    paired: PairedResultSchema.nullable(),
    sessionTitle: z.string(),
    knownUuids: z.array(z.string()),
    projectId: z.string().optional(),
  })
  .nullable();

const DEFAULT_RECENT_PAGE_SIZE = 50;

/** Single page of recent sessions (no pagination) — for compact previews. */
export const recentSessionsQueryOptions = (limit: number) =>
  queryOptions({
    queryKey: ["sessions", "recent", limit] as const,
    queryFn: () => apiFetch(`/api/sessions/recent?limit=${limit}`, RecentSessionsResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

/** Infinite, cursor-paginated recent sessions — for the main sessions list. */
export const recentSessionsInfiniteQueryOptions = (limit: number = DEFAULT_RECENT_PAGE_SIZE) =>
  infiniteQueryOptions({
    queryKey: ["sessions", "recent", "infinite", limit] as const,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : "";
      return apiFetch(`/api/sessions/recent?limit=${limit}${cursor}`, RecentSessionsResponse);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const groupedSessionsQueryOptions = (perProject?: number) =>
  queryOptions({
    queryKey: ["sessions", "grouped", perProject ?? null] as const,
    queryFn: () =>
      apiFetch(
        `/api/sessions/grouped${perProject ? `?perProject=${perProject}` : ""}`,
        GroupedSessionsResponse,
      ),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const starredSessionsQueryOptions = queryOptions({
  queryKey: ["sessions", "starred"] as const,
  queryFn: () => apiFetch("/api/sessions/starred", StarredSessionsResponse),
  staleTime: Infinity,
  gcTime: Infinity,
});

export const sessionTitlesQueryOptions = (ids: string[]) =>
  queryOptions({
    queryKey: ["sessions", "titles", [...ids].sort()] as const,
    queryFn: () =>
      apiFetch(
        `/api/sessions/titles?ids=${encodeURIComponent(ids.join(","))}`,
        SessionTitlesResponse,
      ),
    enabled: ids.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const activeSessionsQueryOptions = (activeTimeoutMs?: number) => {
  const url =
    activeTimeoutMs !== undefined
      ? `/api/sessions/active?activeTimeoutMs=${activeTimeoutMs}`
      : "/api/sessions/active";
  return queryOptions({
    queryKey: ["sessions", "active", activeTimeoutMs] as const,
    queryFn: () => apiFetch(url, ActiveSessionListResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });
};

export const sessionDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["sessions", id] as const,
    queryFn: () => apiFetch(`/api/sessions/${encodeURIComponent(id)}`, SessionDetailResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const transcriptQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["sessions", id, "transcript"] as const,
    queryFn: () =>
      apiFetch(`/api/sessions/${encodeURIComponent(id)}/transcript`, TranscriptResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const sessionSourceQueryOptions = (sessionId: string, uuid: string, contextN = 5) =>
  queryOptions({
    queryKey: ["sessions", sessionId, "source", uuid, contextN] as const,
    queryFn: () =>
      apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/source/${encodeURIComponent(uuid)}?context=${contextN}`,
        SessionSourceResponse,
      ),
    staleTime: Infinity,
    gcTime: Infinity,
  });

const SessionSubagentSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  projectId: z.string(),
  parentAgentId: z.string().nullable(),
  agentType: z.string().nullable(),
  slug: z.string().nullable(),
  description: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export const SessionSubagentsResponse = z.array(SessionSubagentSchema);

export const sessionSubagentsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["sessions", id, "subagents"] as const,
    queryFn: () =>
      apiFetch(`/api/sessions/${encodeURIComponent(id)}/subagents`, SessionSubagentsResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const StarredMutationResponse = z.object({ starred: z.boolean() });
export const useToggleSessionStar = (sessionId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (starred: boolean) =>
      apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/starred`, StarredMutationResponse, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      void qc.invalidateQueries({ queryKey: ["sessions", sessionId] });
    },
  });
};

export const SummaryMutationResponse = z.object({
  summary: z.string().nullable(),
});
export const useRequestSummary = (sessionId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/summary`, SummaryMutationResponse, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sessions", sessionId] });
    },
  });
};
