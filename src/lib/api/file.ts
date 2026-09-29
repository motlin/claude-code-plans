import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { ApiResponseError, apiFetch, resolveUrl } from "./client";

export const FileViewerResponse = z
  .object({
    content: z.string(),
    path: z.string(),
  })
  .strict();
export type FileViewerData = z.infer<typeof FileViewerResponse>;

const FilePreviewUnavailableSchema = z.strictObject({
  kind: z.enum(["binary", "too-large"]),
  size: z.number().int().nonnegative(),
  type: z.string(),
});
export type FilePreviewUnavailable = z.infer<typeof FilePreviewUnavailableSchema>;

export const FileViewerErrorResponse = z.union([
  z.strictObject({ error: z.string() }),
  FilePreviewUnavailableSchema.extend({ error: z.string() }),
]);

/** Encode an absolute path as one opaque, traversal-free route segment. */
export function encodeFilePath(path: string): string {
  const bytes = new TextEncoder().encode(path);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Decode only canonical base64url path tokens produced by {@link encodeFilePath}. */
export function decodeFilePath(token: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;

  const base64 = token.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const path = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return encodeFilePath(path) === token ? path : null;
  } catch {
    return null;
  }
}

export function fileViewerPath(path: string): string {
  return `/file/${encodeFilePath(path)}`;
}

/**
 * The file API URL for one absolute path: JSON text by default, the text of a
 * binary file with `forceText`, or the raw bytes as an attachment with `download`.
 * Image paths always stream their bytes.
 */
export function fileContentUrl(
  path: string,
  options: { forceText?: boolean; download?: boolean } = {},
): string {
  const query = options.download ? "?download=1" : options.forceText ? "?force=text" : "";
  return `/api/file/${encodeFilePath(path)}${query}`;
}

/** Reveal one file in Finder; the server refuses paths outside the viewer's allowed roots. */
export function revealFileInFinder(path: string): Promise<unknown> {
  return apiFetch("/api/reveal-in-finder", z.strictObject({ ok: z.literal(true) }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

/** A file the viewer can show as text, or why it can't. */
type FileViewContent =
  | { kind: "text"; content: string; path: string }
  | { kind: "binary"; size: number; type: string }
  | { kind: "too-large"; size: number; type: string };

async function fetchFileView(
  path: string,
  forceText: boolean,
  signal: AbortSignal,
): Promise<FileViewContent> {
  const url = fileContentUrl(path, { forceText });
  const response = await fetch(resolveUrl(url), { credentials: "same-origin", signal });
  if (response.ok) return { kind: "text", ...FileViewerResponse.parse(await response.json()) };
  if (response.status === 413 || response.status === 415) {
    const body = FileViewerErrorResponse.parse(await response.json());
    if ("kind" in body) {
      const { size, type } = body;
      return body.kind === "binary"
        ? { kind: "binary", size, type }
        : { kind: "too-large", size, type };
    }
  }
  throw new ApiResponseError(url, response);
}

export const fileViewQueryOptions = (path: string, forceText = false) =>
  queryOptions({
    queryKey: ["file", path, forceText ? "text" : "auto"] as const,
    queryFn: ({ signal }) => fetchFileView(path, forceText, signal),
    staleTime: 0,
    gcTime: 5 * 60_000,
  });
