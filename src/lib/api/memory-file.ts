import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";

import {apiFetch} from "./client";

const MemoryFileResponse = z.strictObject(
	{
		content: z.string(),
		writable: z.boolean(),
		etag: z.string(),
	},
);

/** One of a session's memory files as the Memory dialog edits it (`GET /api/sessions/$id/memory-file`). */
export const memoryFileQueryOptions = (sessionId: string, path: string) =>
	queryOptions(
		{
			queryKey: ["session-memory-file", sessionId, path] as const,
			queryFn: async () =>
				apiFetch(
					`/api/sessions/${encodeURIComponent(sessionId)}/memory-file?path=${encodeURIComponent(path)}`,
					MemoryFileResponse,
				),
			staleTime: 0,
		},
	);
