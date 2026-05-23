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
