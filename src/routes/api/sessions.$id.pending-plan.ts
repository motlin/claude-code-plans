import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import type {PendingPlanData} from "../../lib/api/pending-plan";
import {clearPendingPlan, getPendingPlan, pendingPlanWasReloaded} from "../../lib/pending-plan-store";
import {registrySessionAtPrompt} from "../../lib/session-registry-store";

/**
 * The session's pending plan, unless it was reloaded after a restart and its
 * process has since gone back to its prompt without a hook saying so. A plan
 * this process saw proposed stays until its own hooks resolve it.
 */
function currentPendingPlan(sessionId: string) {
	const pending = getPendingPlan(sessionId);
	if (pending === null) return null;
	if (!pendingPlanWasReloaded(sessionId) || !registrySessionAtPrompt(sessionId)) return pending;
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
