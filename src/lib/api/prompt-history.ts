import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

/** Prompts for the composer's ↑/↓ recall, newest first. */
export const PromptHistoryResponse = z.array(z.string());

export function promptHistoryQueryOptions(sessionId: string | undefined) {
  const url =
    sessionId === undefined
      ? "/api/prompt-history"
      : `/api/prompt-history?sessionId=${encodeURIComponent(sessionId)}`;
  return queryOptions({
    queryKey: ["prompt-history", sessionId ?? null],
    queryFn: () => apiFetch(url, PromptHistoryResponse),
    staleTime: 30_000,
  });
}
