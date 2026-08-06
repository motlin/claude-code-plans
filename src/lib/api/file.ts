import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

export const FileViewerResponse = z
  .object({
    content: z.string(),
    path: z.string(),
  })
  .strict();
export type FileViewerData = z.infer<typeof FileViewerResponse>;

export const FileViewerErrorResponse = z
  .object({
    error: z.string(),
  })
  .strict();

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

export const fileViewerQueryOptions = (pathToken: string) =>
  queryOptions({
    queryKey: ["file", pathToken] as const,
    queryFn: ({ signal }) =>
      apiFetch(`/api/file/${pathToken}`, FileViewerResponse, {
        signal,
      }),
    staleTime: 0,
    gcTime: 5 * 60_000,
  });
