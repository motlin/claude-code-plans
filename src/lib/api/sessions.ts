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

export const SessionSummaryStateSchema = z.enum(["idle", "working", "waiting", "unknown", "ended"]);

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
  state: SessionSummaryStateSchema,
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
  title: z.string(),
  createdAt: z.number(),
  lastModified: z.number(),
  state: z.enum(["idle", "working", "waiting", "unknown"]),
  blockedSince: z.string().nullable(),
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
    attributionAgent: z.string().optional(),
    entrypoint: z.string().optional(),
    sessionKind: z.string().optional(),
    teamNames: z.array(z.string()).optional(),
    forkedFromSessionId: z.string().optional(),
  })
  .nullable();

export type SessionDetailData = NonNullable<z.infer<typeof SessionDetailResponse>>;

export const TranscriptResponse = z.object({
  records: z.array(z.record(z.string(), JsonValueSchema)),
  byteOffset: z.number(),
});
export type TranscriptData = z.infer<typeof TranscriptResponse>;

export function mergeTranscriptData(
  primary: TranscriptData,
  secondary: TranscriptData,
): TranscriptData {
  const records: TranscriptData["records"] = [];
  const seenUuids = new Set<string>();

  for (const record of [...primary.records, ...secondary.records]) {
    const uuid = record["uuid"];
    if (typeof uuid === "string") {
      if (seenUuids.has(uuid)) continue;
      seenUuids.add(uuid);
    }
    records.push(record);
  }

  return { records, byteOffset: primary.byteOffset };
}

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
const SESSION_QUERY_ROOT = ["sessions"] as const;
const RECENT_SESSIONS_QUERY_ROOT = [...SESSION_QUERY_ROOT, "recent"] as const;
const GROUPED_SESSIONS_QUERY_ROOT = [...SESSION_QUERY_ROOT, "grouped"] as const;
const ACTIVE_SESSIONS_QUERY_ROOT = [...SESSION_QUERY_ROOT, "active"] as const;

export const sessionQueryKeys = {
  all: () => SESSION_QUERY_ROOT,
  recentLists: () => RECENT_SESSIONS_QUERY_ROOT,
  recent: (limit: number) => [...RECENT_SESSIONS_QUERY_ROOT, limit] as const,
  recentInfinite: (limit: number = DEFAULT_RECENT_PAGE_SIZE) =>
    [...RECENT_SESSIONS_QUERY_ROOT, "infinite", limit] as const,
  groupedLists: () => GROUPED_SESSIONS_QUERY_ROOT,
  grouped: (perProject?: number) => [...GROUPED_SESSIONS_QUERY_ROOT, perProject ?? null] as const,
  starred: () => [...SESSION_QUERY_ROOT, "starred"] as const,
  titles: (ids: string[]) => [...SESSION_QUERY_ROOT, "titles", [...ids].sort()] as const,
  activeLists: () => ACTIVE_SESSIONS_QUERY_ROOT,
  active: (activeTimeoutMs?: number) => [...ACTIVE_SESSIONS_QUERY_ROOT, activeTimeoutMs] as const,
  detail: (id: string) => [...SESSION_QUERY_ROOT, id] as const,
  transcript: (id: string) => [...SESSION_QUERY_ROOT, id, "transcript"] as const,
  source: (sessionId: string, uuid: string, contextN: number) =>
    [...SESSION_QUERY_ROOT, sessionId, "source", uuid, contextN] as const,
  subagents: (id: string) => [...SESSION_QUERY_ROOT, id, "subagents"] as const,
};

/** Single page of recent sessions (no pagination) — for compact previews. */
export const recentSessionsQueryOptions = (limit: number) =>
  queryOptions({
    queryKey: sessionQueryKeys.recent(limit),
    queryFn: () => apiFetch(`/api/sessions/recent?limit=${limit}`, RecentSessionsResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

/** Infinite, cursor-paginated recent sessions — for the main sessions list. */
export const recentSessionsInfiniteQueryOptions = (limit: number = DEFAULT_RECENT_PAGE_SIZE) =>
  infiniteQueryOptions({
    queryKey: sessionQueryKeys.recentInfinite(limit),
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
    queryKey: sessionQueryKeys.grouped(perProject),
    queryFn: () =>
      apiFetch(
        `/api/sessions/grouped${perProject ? `?perProject=${perProject}` : ""}`,
        GroupedSessionsResponse,
      ),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const starredSessionsQueryOptions = queryOptions({
  queryKey: sessionQueryKeys.starred(),
  queryFn: () => apiFetch("/api/sessions/starred", StarredSessionsResponse),
  staleTime: Infinity,
  gcTime: Infinity,
});

export const sessionTitlesQueryOptions = (ids: string[]) =>
  queryOptions({
    queryKey: sessionQueryKeys.titles(ids),
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
    queryKey: sessionQueryKeys.active(activeTimeoutMs),
    queryFn: () => apiFetch(url, ActiveSessionListResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });
};

export const sessionDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: sessionQueryKeys.detail(id),
    queryFn: () => apiFetch(`/api/sessions/${encodeURIComponent(id)}`, SessionDetailResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const transcriptQueryOptions = (id: string) =>
  queryOptions({
    queryKey: sessionQueryKeys.transcript(id),
    queryFn: () =>
      apiFetch(`/api/sessions/${encodeURIComponent(id)}/transcript`, TranscriptResponse),
    structuralSharing: (oldData, newData) => {
      const refreshed = TranscriptResponse.parse(newData);
      if (oldData === undefined) return refreshed;
      return mergeTranscriptData(refreshed, TranscriptResponse.parse(oldData));
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const sessionSourceQueryOptions = (sessionId: string, uuid: string, contextN = 5) =>
  queryOptions({
    queryKey: sessionQueryKeys.source(sessionId, uuid, contextN),
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
  attributionAgent: z.string().nullable(),
  slug: z.string().nullable(),
  description: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export const SessionSubagentsResponse = z.array(SessionSubagentSchema);
export type SessionSubagentsData = z.infer<typeof SessionSubagentsResponse>;

export const sessionSubagentsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: sessionQueryKeys.subagents(id),
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
      void qc.invalidateQueries({ queryKey: sessionQueryKeys.all() });
      void qc.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
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
      void qc.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) });
    },
  });
};
