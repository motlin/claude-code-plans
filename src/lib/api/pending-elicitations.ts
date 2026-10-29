import {z} from "zod";
import {queryOptions, type QueryClient} from "@tanstack/react-query";
import {PendingElicitationSchema, type SessionElicitationChangedPayload} from "../domain-event-payload-schemas";
import {apiFetch} from "./client";

/** `/api/sessions/$id/pending-elicitations`: the MCP elicitations the session waits on, oldest first. */
export const PendingElicitationsResponse = z.strictObject({
	pendingElicitations: z.array(PendingElicitationSchema),
});
export type PendingElicitationsData = z.infer<typeof PendingElicitationsResponse>;

/** Fetched once per session; `session:elicitation-changed` patches it from then on. */
export const pendingElicitationsQueryOptions = (sessionId: string) =>
	queryOptions({
		queryKey: ["pending-elicitations", sessionId] as const,
		queryFn: async () =>
			apiFetch(
				`/api/sessions/${encodeURIComponent(sessionId)}/pending-elicitations`,
				PendingElicitationsResponse,
			),
		staleTime: Infinity,
	});

export function applyPendingElicitationsChanged(
	queryClient: QueryClient,
	{sessionId, pendingElicitations}: SessionElicitationChangedPayload,
): void {
	queryClient.setQueryData<PendingElicitationsData>(pendingElicitationsQueryOptions(sessionId).queryKey, {
		pendingElicitations,
	});
}
