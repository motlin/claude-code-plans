import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";

import {apiFetch} from "./client";

/** Enough for every inline code and tool path in a long transcript window. */
export const MAX_FILE_REF_PATHS = 1000;

/**
 * Where a ref's path stands: a regular file inside the allowed roots, nothing
 * readable inside them, or outside every root (symlinks resolved).
 */
export const FileRefStatusSchema = z.enum(["exists", "missing", "outside"]);
export type FileRefStatus = z.infer<typeof FileRefStatusSchema>;

export const FileRefsResponseSchema = z.strictObject({statuses: z.record(z.string(), FileRefStatusSchema)});

interface PendingCheck {
	resolve: (status: FileRefStatus) => void;
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
			const {statuses} = await apiFetch("/api/file-refs", FileRefsResponseSchema, {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({paths: chunk}),
			});
			for (const path of chunk) {
				for (const check of batch.get(path) ?? []) check.resolve(statuses[path] ?? "missing");
			}
		} catch (error) {
			for (const path of chunk) for (const check of batch.get(path) ?? []) check.reject(error);
		}
	}
}

async function checkFileRefStatus(path: string): Promise<FileRefStatus> {
	return new Promise((resolve, reject) => {
		const checks = pending.get(path) ?? [];
		checks.push({resolve, reject});
		pending.set(path, checks);
		if (!scheduled) {
			scheduled = true;
			setTimeout(() => void flush(), 0);
		}
	});
}

/** The {@link FileRefStatus} of `path`, batched with its neighbours. */
export const fileRefStatusQueryOptions = (path: string) =>
	queryOptions({
		queryKey: ["file-ref-status", path] as const,
		queryFn: async () => checkFileRefStatus(path),
		staleTime: 60_000,
	});
