import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import type {PendingPlanData} from "../../lib/api/pending-plan";
import {clearPendingPlan, getPendingPlan} from "../../lib/pending-plan-store";
import {getRegistrySessionState} from "../../lib/session-registry-store";

/** The session's pending plan, unless its process has since stopped waiting without a hook saying so. */
function currentPendingPlan(sessionId: string) {
	const pending = getPendingPlan(sessionId);
	if (pending === null) return null;
	const registry = getRegistrySessionState(sessionId);
	if (registry === null || registry.status === "waiting") return pending;
	clearPendingPlan(sessionId);
	return null;
}

export function handlePendingPlanRequest(sessionId: string): Response {
	return Response.json({pendingPlan: currentPendingPlan(sessionId)} satisfies PendingPlanData, {
		headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
	});
}

export const Route = createFileRoute("/api/sessions/$id/pending-plan")({
	server: {
		handlers: withMethodNotAllowed({
			GET: ({params}: {params: {id: string}}) => handlePendingPlanRequest(params.id),
		}),
	},
});
