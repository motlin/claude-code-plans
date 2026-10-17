import {z} from "zod";
import {queryOptions, type QueryClient} from "@tanstack/react-query";
import {PendingPlanSchema, type SessionPendingPlanChangedPayload} from "../hook-events";
import {apiFetch} from "./client";

/** `/api/sessions/$id/pending-plan`: the ExitPlanMode the session waits on, from its hooks. */
export const PendingPlanResponse = z.strictObject({
	pendingPlan: PendingPlanSchema.nullable(),
});
export type PendingPlanData = z.infer<typeof PendingPlanResponse>;

/** Fetched once per session; `session:pending-plan-changed` patches it from then on. */
export const pendingPlanQueryOptions = (sessionId: string) =>
	queryOptions({
		queryKey: ["pending-plan", sessionId] as const,
		queryFn: async () =>
			apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/pending-plan`, PendingPlanResponse),
		staleTime: Infinity,
	});

export function applyPendingPlanChanged(
	queryClient: QueryClient,
	{sessionId, pendingPlan}: SessionPendingPlanChangedPayload,
): void {
	queryClient.setQueryData<PendingPlanData>(pendingPlanQueryOptions(sessionId).queryKey, {pendingPlan});
}
