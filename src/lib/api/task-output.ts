import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";

import {apiFetch} from "./client";
import {sessionQueryKeys} from "./sessions";

export const TaskOutputResponse = z.discriminatedUnion("status", [
	z.strictObject({status: z.literal("ok"), output: z.string(), truncated: z.boolean()}),
	z.strictObject({status: z.literal("missing")}),
]);

/** How often a running task's output re-reads while its card is open. */
const RUNNING_REFRESH_MS = 2000;

export const taskOutputQueryOptions = (sessionId: string, file: string, running: boolean) =>
	queryOptions({
		queryKey: [...sessionQueryKeys.detail(sessionId), "task-output", file] as const,
		queryFn: async () =>
			apiFetch(
				`/api/sessions/${encodeURIComponent(sessionId)}/task-output?file=${encodeURIComponent(file)}`,
				TaskOutputResponse,
			),
		refetchInterval: running ? RUNNING_REFRESH_MS : false,
		staleTime: running ? 0 : Infinity,
	});
