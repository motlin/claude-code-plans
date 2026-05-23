import { z } from "zod";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { JsonValueSchema } from "../schemas";

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
});

const SessionProjectGroupSchema = z.object({
  project: z.string(),
  projectName: z.string(),
  sessions: z.array(SessionListItemSchema),
});
export const SessionListResponse = z.array(SessionProjectGroupSchema);

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
    starred: z.boolean(),
    summary: z.string().nullable(),
    projectPath: z.string().nullable(),
    gitBranch: z.string().nullable(),
    cwd: z.string().nullable(),
    gitSha: z.string().nullable(),
    gitClean: z.boolean().nullable(),
    messageCount: z.number(),
    pendingTaskCount: z.number(),
    parentSessionId: z.string().optional(),
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

export const sessionsQueryOptions = queryOptions({
  queryKey: ["sessions"] as const,
  queryFn: () => apiFetch("/api/sessions", SessionListResponse),
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
