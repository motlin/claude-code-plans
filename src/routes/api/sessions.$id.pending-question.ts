import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import type {PendingQuestionData} from "../../lib/api/pending-question";
import {getPendingQuestion} from "../../lib/pending-question-store";

export function handlePendingQuestionRequest(sessionId: string): Response {
	return Response.json({pendingQuestion: getPendingQuestion(sessionId)} satisfies PendingQuestionData, {
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
