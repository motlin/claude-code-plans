import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import type {PendingElicitationsData} from "../../lib/api/pending-elicitations";
import {getPendingElicitations} from "../../lib/pending-elicitations";

export function handlePendingElicitationsRequest(sessionId: string): Response {
	return Response.json({pendingElicitations: getPendingElicitations(sessionId)} satisfies PendingElicitationsData, {
		headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
	});
}

export const Route = createFileRoute("/api/sessions/$id/pending-elicitations")({
	server: {
		handlers: withMethodNotAllowed({
			GET: ({params}: {params: {id: string}}) => handlePendingElicitationsRequest(params.id),
		}),
	},
});
