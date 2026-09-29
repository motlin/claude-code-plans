import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

const WorkspaceEntrySchema = z
  .object({
    name: z.string(),
    relPath: z.string(),
    isDirectory: z.boolean(),
    symlink: z
      .object({ target: z.string(), outside: z.boolean(), broken: z.boolean() })
      .strict()
      .optional(),
  })
  .strict();

export const SessionFilesResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("listing"),
      dir: z.string(),
      entries: z.array(WorkspaceEntrySchema),
      /** The directory has more entries than were returned. */
      partial: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("search"),
      dir: z.string(),
      query: z.string(),
      results: z.array(WorkspaceEntrySchema),
      /** The workspace walk stopped early, so some entries were never considered. */
      partial: z.boolean(),
      /** More paths matched than were returned. */
      capped: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal("no-cwd") }).strict(),
]);

export type SessionFilesResponse = z.infer<typeof SessionFilesResponseSchema>;

export const SessionFilesErrorResponseSchema = z.object({ error: z.string() }).strict();

export interface SessionFilesQuery {
  /** Directory relative to the session's working directory; "" for the root. */
  dir: string;
  /** Fuzzy path query; "" lists `dir` instead of searching. */
  query: string;
  hideIgnored: boolean;
}

function sessionFilesUrl(
  sessionId: string,
  { dir, query, hideIgnored }: SessionFilesQuery,
): string {
  const parameters = new URLSearchParams();
  if (dir !== "") parameters.set("dir", dir);
  if (query !== "") parameters.set("q", query);
  if (hideIgnored) parameters.set("hideIgnored", "1");
  const search = parameters.toString();
  return `/api/sessions/${encodeURIComponent(sessionId)}/files${search === "" ? "" : `?${search}`}`;
}

/** The session's workspace listing (or fuzzy search), with paths in the query string. */
export const sessionFilesQueryOptions = (sessionId: string, query: SessionFilesQuery) =>
  queryOptions({
    queryKey: ["session-files", sessionId, query.dir, query.query, query.hideIgnored] as const,
    queryFn: () => apiFetch(sessionFilesUrl(sessionId, query), SessionFilesResponseSchema),
  });
