import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

const SessionSearchItemSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  firstPrompt: z.string().nullable(),
  summary: z.string().nullable(),
  snippet: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  mtime: z.string(),
  messageCount: z.number(),
  rank: z.number(),
});
export type SessionSearchItem = z.infer<typeof SessionSearchItemSchema>;
export const SessionSearchResponse = z.array(SessionSearchItemSchema);

const MessageSearchItemSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  snippet: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  mtime: z.string(),
  messageCount: z.number(),
  rank: z.number(),
});
export type MessageSearchItem = z.infer<typeof MessageSearchItemSchema>;
export const MessageSearchResponse = z.array(MessageSearchItemSchema);

const FileSearchMatchSchema = z
  .object({
    lineNumber: z.number().int().positive(),
    snippet: z.string(),
  })
  .strict();

const FileSearchFileSchema = z
  .object({
    path: z.string(),
    matchCount: z.number().int().nonnegative(),
    matches: z.array(FileSearchMatchSchema),
    mtime: z.string(),
    rank: z.number(),
  })
  .strict();

export const FileSearchResponse = z
  .object({
    files: z.array(FileSearchFileSchema),
    totalResults: z.number().int().nonnegative(),
    totalFiles: z.number().int().nonnegative(),
    isTruncated: z.boolean(),
  })
  .strict();
export type FileSearchResult = z.infer<typeof FileSearchResponse>;

export const sessionSearchQueryOptions = (query: string) =>
  queryOptions({
    queryKey: ["search", "sessions", query] as const,
    queryFn: () =>
      apiFetch(`/api/search/sessions?query=${encodeURIComponent(query)}`, SessionSearchResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const messageSearchQueryOptions = (query: string) =>
  queryOptions({
    queryKey: ["search", "messages", query] as const,
    queryFn: () =>
      apiFetch(`/api/search/messages?query=${encodeURIComponent(query)}`, MessageSearchResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const fileSearchQueryOptions = (query: string, scopeRoot: string) =>
  queryOptions({
    queryKey: ["search", "files", query, scopeRoot] as const,
    queryFn: ({ signal }) => {
      const parameters = new URLSearchParams({ query, scopeRoot });
      return apiFetch(`/api/search/files?${parameters.toString()}`, FileSearchResponse, { signal });
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
