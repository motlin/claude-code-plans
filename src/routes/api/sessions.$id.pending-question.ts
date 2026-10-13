import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import type {PendingQuestionData} from "../../lib/api/pending-question";
import {clearPendingQuestion, getPendingQuestion} from "../../lib/pending-question-store";
import {getRegistrySessionState} from "../../lib/session-registry-store";

/**
 * The session's pending question, unless its process has since stopped
 * waiting: a question reloaded after a restart may have been answered while
 * this server was down, which no hook reported.
 */
function currentPendingQuestion(sessionId: string) {
	const pending = getPendingQuestion(sessionId);
	if (pending === null) return null;
	const registry = getRegistrySessionState(sessionId);
	if (registry === null || registry.status === "waiting") return pending;
	clearPendingQuestion(sessionId);
	return null;
}

export function handlePendingQuestionRequest(sessionId: string): Response {
	return Response.json({pendingQuestion: currentPendingQuestion(sessionId)} satisfies PendingQuestionData, {
		headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
	});
}

export const Route = createFileRoute("/api/sessions/$id/pending-question")({
	server: {
		handlers: withMethodNotAllowed({
			GET: ({params}: {params: {id: string}}) => handlePendingQuestionRequest(params.id),
		}),
	},
});
