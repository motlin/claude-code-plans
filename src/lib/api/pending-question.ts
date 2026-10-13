import {z} from "zod";
import {queryOptions, type QueryClient} from "@tanstack/react-query";
import {PendingQuestionSchema, type SessionPendingQuestionChangedPayload} from "../hook-events";
import {apiFetch} from "./client";

/** `/api/sessions/$id/pending-question`: the AskUserQuestion the session waits on, from its hooks. */
export const PendingQuestionResponse = z.strictObject({
	pendingQuestion: PendingQuestionSchema.nullable(),
});
export type PendingQuestionData = z.infer<typeof PendingQuestionResponse>;

/** Fetched once per session; `session:pending-question-changed` patches it from then on. */
export const pendingQuestionQueryOptions = (sessionId: string) =>
	queryOptions({
		queryKey: ["pending-question", sessionId] as const,
		queryFn: async () =>
			apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/pending-question`, PendingQuestionResponse),
		staleTime: Infinity,
	});

export function applyPendingQuestionChanged(
	queryClient: QueryClient,
	{sessionId, pendingQuestion}: SessionPendingQuestionChangedPayload,
): void {
	queryClient.setQueryData<PendingQuestionData>(pendingQuestionQueryOptions(sessionId).queryKey, {pendingQuestion});
}
