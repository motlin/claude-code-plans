import { z } from "zod";
import {
  queryOptions,
  infiniteQueryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./client";
import { JsonValueSchema } from "../schemas";
import { SessionViewedStateSchema } from "./viewed-state";
import { SessionBucketSchema } from "../session-state";
import { PrStatusSchema } from "../pr-status";
import type { SessionStatusFilter } from "../session-groups";

export const SessionSummaryStateSchema = z.enum(["idle", "working", "waiting", "unknown", "ended"]);

const SessionPrLinkSchema = z.object({
  number: z.number(),
  url: z.string(),
  repository: z.string(),
});

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
  pr: SessionPrLinkSchema.optional(),
  prStatus: PrStatusSchema.optional(),
  forkedFromSessionId: z.string().optional(),
  archived: z.boolean(),
  state: SessionSummaryStateSchema,
  bucket: SessionBucketSchema,
  liveAgentCount: z.number(),
  unseen: z.boolean(),
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
export type ProjectSessionGroup = z.infer<typeof SessionGroupSummarySchema>;
export const GroupedSessionsResponse = z.array(SessionGroupSummarySchema);

/** Session rows looked up by id, e.g. this browser's pins; unknown ids are omitted. */
export const SessionsByIdsResponse = z.array(SessionListItemSchema);

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
  unseen: z.boolean(),
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
    archived: z.boolean(),
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
    /** Raw model id a subagent session ran on, e.g. `claude-haiku-4-5-20251001`. */
    model: z.string().optional(),
    entrypoint: z.string().optional(),
    sessionKind: z.string().optional(),
    teamNames: z.array(z.string()).optional(),
    forkedFromSessionId: z.string().optional(),
    pr: SessionPrLinkSchema.optional(),
    /** The PR status service's best answer for this session, when it knows one. */
    prStatus: PrStatusSchema.optional(),
    /** The plan file linked to this session through `plan_sessions`. */
    planFilename: z.string().optional(),
  })
  .nullable();

export const SessionOpenInResponse = z
  .object({ cwd: z.string().nullable(), bridgeSessionId: z.string().nullable() })
  .strict();

export type SessionDetailData = NonNullable<z.infer<typeof SessionDetailResponse>>;

/**
 * One window over a session's JSONL, not the whole file: the endpoint serves
 * the tail so a megabyte-scale session paints its newest messages immediately,
 * and the client pages backwards from `startIndex`.
 */
export const TranscriptResponse = z.object({
  records: z.array(z.record(z.string(), JsonValueSchema)),
  byteOffset: z.number(),
  /** Index of `records[0]` within the session's full JSONL record list. */
  startIndex: z.number(),
  /** Countable messages (message-count.ts) in the records before `startIndex`. */
  precedingMessageCount: z.number(),
});
export type TranscriptData = z.infer<typeof TranscriptResponse>;

/**
 * Index just past the newest record the window holds. `records.length` is the
 * right basis even though `mergeTranscriptData` may have dropped duplicates:
 * merging re-keys every survivor contiguously from `startIndex`, so a dropped
 * record leaves no hole to account for. Keying an append past this — at the
 * pre-dedupe span instead — would open a gap that the contiguity gate then
 * resolves by discarding the whole window.
 */
export function transcriptEndIndex(transcript: TranscriptData): number {
  return transcript.startIndex + transcript.records.length;
}

/**
 * Merge two windows into one, keyed by each record's index in the JSONL so an
 * earlier page lands ahead of the tail it was paged back from. `primary` wins
 * every conflict and supplies `byteOffset`.
 *
 * Only the contiguous run ending at the newest record survives: if a refetch
 * returns a tail that starts past where the cached window ended, the records in
 * between were never fetched, and rendering across that hole would splice
 * unrelated turns together.
 */
export function mergeTranscriptData(
  primary: TranscriptData,
  secondary: TranscriptData,
): TranscriptData {
  const byIndex = new Map<number, TranscriptData["records"][number]>();
  for (const source of [secondary, primary]) {
    source.records.forEach((record, offset) => byIndex.set(source.startIndex + offset, record));
  }
  const indices = [...byIndex.keys()].sort((a, b) => a - b);
  let runStart = indices.length - 1;
  while (runStart > 0 && indices[runStart - 1] === indices[runStart]! - 1) runStart -= 1;
  const contiguous = indices.slice(Math.max(runStart, 0));

  const records: TranscriptData["records"] = [];
  const seenUuids = new Set<string>();
  for (const index of contiguous) {
    const record = byIndex.get(index)!;
    const uuid = record["uuid"];
    if (typeof uuid === "string") {
      if (seenUuids.has(uuid)) continue;
      seenUuids.add(uuid);
    }
    records.push(record);
  }

  const startIndex = contiguous[0] ?? primary.startIndex;
  // The surviving run always begins at one of the two windows' first records,
  // and that window is the one that knows how many messages precede it.
  const origin = primary.startIndex === startIndex ? primary : secondary;
  return {
    records,
    byteOffset: primary.byteOffset,
    startIndex,
    precedingMessageCount: origin.precedingMessageCount,
  };
}

const ResourceOccurrenceSchema = z.object({
  source: z.enum(["visible", "tool", "thinking"]),
  anchorIndex: z.number(),
  anchorUuid: z.string().optional(),
  role: z.enum(["user", "assistant"]),
  tool: z.string().optional(),
});

const SessionFilesSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      absolutePath: z.string(),
      occurrences: z.array(ResourceOccurrenceSchema),
    }),
  ),
  totalCount: z.number(),
  counts: z.object({
    userMessage: z.number(),
    agentMessage: z.number(),
    read: z.number(),
    editWrite: z.number(),
    bash: z.number(),
    grepGlob: z.number(),
    thinking: z.number(),
    other: z.number(),
  }),
});

/**
 * The whole session's file and link inventory, scanned on demand.
 *
 * The transcript endpoint serves a window, so the browser's own extraction can
 * only report a floor. A drawer opening asks for this instead. Links arrive
 * uncategorized: which category a URL falls into depends on the host serving
 * this page and on the reader's `linkCategoryRules`, neither of which the
 * server knows, so the browser groups them with `groupSessionLinks`.
 */
export const SessionResourcesResponse = z.object({
  files: SessionFilesSchema,
  links: z.array(
    z.object({
      url: z.string(),
      label: z.string(),
      occurrences: z.array(ResourceOccurrenceSchema),
    }),
  ),
});

/** Loopback dev servers the session declared or printed, with a liveness probe. */
export const SessionDevServersResponse = z
  .object({
    servers: z.array(
      z.object({ url: z.string(), name: z.string().optional(), live: z.boolean() }).strict(),
    ),
  })
  .strict();

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
/**
 * Sessions kept per project group. Deep enough to show what a project was
 * recently doing, shallow enough that seventeen projects still fit a scroll or
 * two; groups past it link out to the project's own session list. Both
 * `/sessions` and the sidebar's Sessions tree share this one query, so they can
 * never disagree about which sessions a project's group holds.
 */
const SESSION_GROUP_PAGE_SIZE = 5;
const SESSION_QUERY_ROOT = ["sessions"] as const;
const RECENT_SESSIONS_QUERY_ROOT = [...SESSION_QUERY_ROOT, "recent"] as const;
const GROUPED_SESSIONS_QUERY_ROOT = [...SESSION_QUERY_ROOT, "grouped"] as const;
const ACTIVE_SESSIONS_QUERY_ROOT = [...SESSION_QUERY_ROOT, "active"] as const;

export const sessionQueryKeys = {
  all: () => SESSION_QUERY_ROOT,
  recentLists: () => RECENT_SESSIONS_QUERY_ROOT,
  recent: (limit: number) => [...RECENT_SESSIONS_QUERY_ROOT, limit] as const,
  recentInfinite: (
    limit: number = DEFAULT_RECENT_PAGE_SIZE,
    status: SessionStatusFilter = "active",
  ) => [...RECENT_SESSIONS_QUERY_ROOT, "infinite", limit, status] as const,
  groupedLists: () => GROUPED_SESSIONS_QUERY_ROOT,
  grouped: (perProject: number = SESSION_GROUP_PAGE_SIZE) =>
    [...GROUPED_SESSIONS_QUERY_ROOT, perProject] as const,
  byIds: (ids: readonly string[]) => [...SESSION_QUERY_ROOT, "by-ids", [...ids].sort()] as const,
  titles: (ids: string[]) => [...SESSION_QUERY_ROOT, "titles", [...ids].sort()] as const,
  activeLists: () => ACTIVE_SESSIONS_QUERY_ROOT,
  active: (activeTimeoutMs?: number) => [...ACTIVE_SESSIONS_QUERY_ROOT, activeTimeoutMs] as const,
  detail: (id: string) => [...SESSION_QUERY_ROOT, id] as const,
  transcript: (id: string) => [...SESSION_QUERY_ROOT, id, "transcript"] as const,
  resources: (id: string) => [...SESSION_QUERY_ROOT, id, "resources"] as const,
  devServers: (id: string) => [...SESSION_QUERY_ROOT, id, "dev-servers"] as const,
  artifacts: (id: string) => [...SESSION_QUERY_ROOT, id, "artifacts"] as const,
  source: (sessionId: string, uuid: string, contextN: number) =>
    [...SESSION_QUERY_ROOT, sessionId, "source", uuid, contextN] as const,
  subagents: (id: string) => [...SESSION_QUERY_ROOT, id, "subagents"] as const,
  openIn: (id: string) => [...SESSION_QUERY_ROOT, id, "open-in"] as const,
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
export const recentSessionsInfiniteQueryOptions = (
  limit: number = DEFAULT_RECENT_PAGE_SIZE,
  status: SessionStatusFilter = "active",
) =>
  infiniteQueryOptions({
    queryKey: sessionQueryKeys.recentInfinite(limit, status),
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : "";
      const statusParam = status === "active" ? "" : `&status=${status}`;
      return apiFetch(
        `/api/sessions/recent?limit=${limit}${cursor}${statusParam}`,
        RecentSessionsResponse,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const groupedSessionsQueryOptions = (perProject: number = SESSION_GROUP_PAGE_SIZE) =>
  queryOptions({
    queryKey: sessionQueryKeys.grouped(perProject),
    queryFn: () =>
      apiFetch(`/api/sessions/grouped?perProject=${perProject}`, GroupedSessionsResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const sessionsByIdsQueryOptions = (ids: readonly string[]) =>
  queryOptions({
    queryKey: sessionQueryKeys.byIds(ids),
    queryFn: () =>
      ids.length === 0
        ? Promise.resolve([])
        : apiFetch(
            `/api/sessions/lookup?ids=${encodeURIComponent([...ids].sort().join(","))}`,
            SessionsByIdsResponse,
          ),
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

export const sessionOpenInQueryOptions = (id: string) =>
  queryOptions({
    queryKey: sessionQueryKeys.openIn(id),
    queryFn: () =>
      apiFetch(`/api/sessions/${encodeURIComponent(id)}/open-in`, SessionOpenInResponse),
  });

/** Reveal the session's own directory in Finder; the server resolves the path from the index. */
export function openSessionInFinder(sessionId: string): Promise<unknown> {
  return apiFetch("/api/open-in-finder", z.object({ ok: z.literal(true) }).strict(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

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

/**
 * Whole-session file and link inventory, fetched only once a drawer wants it.
 *
 * `enabled` is the point of the option: the scan reads and processes the entire
 * JSONL, so it must not run for every session the reader merely opens. A live
 * session's appends invalidate this key (see `applySessionLinesAppended`), and
 * because an inactive query is only marked stale, a closed drawer costs
 * nothing -- the refetch happens when it is next open.
 */
export const sessionResourcesQueryOptions = (id: string, enabled: boolean) =>
  queryOptions({
    queryKey: sessionQueryKeys.resources(id),
    queryFn: () =>
      apiFetch(`/api/sessions/${encodeURIComponent(id)}/resources`, SessionResourcesResponse),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });

/**
 * "Open dev server" links for the Links pane, fetched only while it is open.
 * Liveness goes stale quickly, so each opening re-probes.
 */
export const sessionDevServersQueryOptions = (id: string, enabled: boolean) =>
  queryOptions({
    queryKey: sessionQueryKeys.devServers(id),
    queryFn: () =>
      apiFetch(`/api/sessions/${encodeURIComponent(id)}/dev-servers`, SessionDevServersResponse),
    enabled,
    staleTime: 0,
  });

/**
 * Pages already on the wire, keyed by session and by the window edge they were
 * asked for. Two independent readers page backwards -- the scroll sentinel at
 * the top of the transcript and a drawer jump walking towards its message --
 * and they read the same window, so without this they would both ask
 * for the same page at the same time. Held per QueryClient so one client's
 * request is never handed to another's cache.
 */
const earlierTranscriptRequests = new WeakMap<QueryClient, Map<string, Promise<void>>>();

function inFlightEarlierPages(queryClient: QueryClient): Map<string, Promise<void>> {
  const existing = earlierTranscriptRequests.get(queryClient);
  if (existing) return existing;
  const created = new Map<string, Promise<void>>();
  earlierTranscriptRequests.set(queryClient, created);
  return created;
}

/**
 * Pull the page of records immediately before the cached window and splice it
 * in, so scrolling back through a long session keeps walking towards its first
 * message. A no-op once the window already starts at record 0. Callers that
 * overlap on the same page share one request; each landed page moves the
 * window, so the next call is a fresh request for the page before it.
 */
export function fetchEarlierTranscript(queryClient: QueryClient, sessionId: string): Promise<void> {
  const queryKey = sessionQueryKeys.transcript(sessionId);
  const cached = queryClient.getQueryData<TranscriptData>(queryKey);
  if (!cached || cached.startIndex === 0) return Promise.resolve();

  const inFlight = inFlightEarlierPages(queryClient);
  const before = cached.startIndex;
  const key = `${sessionId}:${before}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = apiFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/transcript?before=${before}`,
    TranscriptResponse,
  )
    .then((page) => {
      queryClient.setQueryData<TranscriptData>(queryKey, (old) =>
        old ? mergeTranscriptData(old, page) : page,
      );
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

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
  model: z.string().nullable(),
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

export const ArchivedMutationResponse = z.object({ archived: z.boolean() });

/** Set or clear the app-side archive flag, then refetch every list and the session's detail. */
export async function requestSessionArchived(
  qc: QueryClient,
  sessionId: string,
  archived: boolean,
): Promise<void> {
  await apiFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/archived`,
    ArchivedMutationResponse,
    {
      method: archived ? "PUT" : "DELETE",
    },
  );
  for (const queryKey of [
    sessionQueryKeys.all(),
    sessionQueryKeys.recentLists(),
    sessionQueryKeys.groupedLists(),
    sessionQueryKeys.activeLists(),
  ]) {
    void qc.invalidateQueries({ queryKey });
  }
}
export const RenameSessionBody = z.object({ title: z.string() }).strict();
export const RenameSessionResponse = z
  .object({ customTitle: z.string().nullable(), title: z.string() })
  .strict();
export const useRenameSessionMutation = (sessionId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title: string) =>
      apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/title`, RenameSessionResponse, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }),
    onSuccess: () => {
      for (const queryKey of [
        sessionQueryKeys.all(),
        sessionQueryKeys.recentLists(),
        sessionQueryKeys.groupedLists(),
        sessionQueryKeys.activeLists(),
      ]) {
        void qc.invalidateQueries({ queryKey });
      }
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
