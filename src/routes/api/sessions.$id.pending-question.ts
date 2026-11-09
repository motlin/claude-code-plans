import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import type {PendingQuestionData} from "../../lib/api/pending-question";
import {clearPendingQuestion, getPendingQuestion, pendingQuestionWasReloaded} from "../../lib/pending-question-store";
import {registrySessionAtPrompt} from "../../lib/session-registry-store";

/**
 * The session's pending question, unless it was reloaded after a restart and
 * its process has since gone back to its prompt: it may have been answered
 * while this server was down, which no hook reported. A question this process
 * saw asked stays until its own hooks resolve it, whatever the registry reads.
 */
function currentPendingQuestion(sessionId: string) {
	const pending = getPendingQuestion(sessionId);
	if (pending === null) return null;
	if (!pendingQuestionWasReloaded(sessionId) || !registrySessionAtPrompt(sessionId)) return pending;
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
