import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "./client";

/** Enough for every inline code and tool path in a long transcript window. */
export const MAX_FILE_REF_PATHS = 1000;

export const FileRefsResponseSchema = z.strictObject({ existing: z.array(z.string()) });

interface PendingCheck {
  resolve: (exists: boolean) => void;
  reject: (error: unknown) => void;
}

/**
 * Coalesces every existence check requested in one tick into a single
 * `POST /api/file-refs`, so a transcript full of refs costs one round trip.
 */
let pending = new Map<string, PendingCheck[]>();
let scheduled = false;

async function flush(): Promise<void> {
  const batch = pending;
  pending = new Map();
  scheduled = false;
  const paths = [...batch.keys()];
  for (let start = 0; start < paths.length; start += MAX_FILE_REF_PATHS) {
    const chunk = paths.slice(start, start + MAX_FILE_REF_PATHS);
    try {
      const { existing } = await apiFetch("/api/file-refs", FileRefsResponseSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: chunk }),
      });
      const found = new Set(existing);
      for (const path of chunk) {
        for (const check of batch.get(path) ?? []) check.resolve(found.has(path));
      }
    } catch (error) {
      for (const path of chunk) for (const check of batch.get(path) ?? []) check.reject(error);
    }
  }
}

function checkFileExists(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const checks = pending.get(path) ?? [];
    checks.push({ resolve, reject });
    pending.set(path, checks);
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => void flush(), 0);
    }
  });
}

/** Whether `path` is a regular file the file API will serve, batched with its neighbours. */
export const fileExistsQueryOptions = (path: string) =>
  queryOptions({
    queryKey: ["file-exists", path] as const,
    queryFn: () => checkFileExists(path),
    staleTime: 60_000,
  });
