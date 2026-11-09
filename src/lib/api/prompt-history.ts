import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/** The composer's ↑/↓ recall, newest first: chat prompts, and the shell commands bash mode walks. */
export const PromptHistoryResponse = z.object({
	prompts: z.array(z.string()),
	bashCommands: z.array(z.string()),
});

export function promptHistoryQueryOptions(sessionId: string | undefined) {
	const url =
		sessionId === undefined
			? "/api/prompt-history"
			: `/api/prompt-history?sessionId=${encodeURIComponent(sessionId)}`;
	return queryOptions({
		queryKey: ["prompt-history", sessionId ?? null],
		queryFn: async () => apiFetch(url, PromptHistoryResponse),
		staleTime: 30_000,
	});
}
