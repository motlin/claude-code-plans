import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {ApiRequestMessagesSchema} from "../../lib/api-request-messages";

/** The messages one API request appended (its tail), fetched when a Request disclosure's Messages section opens. */
export const Route = createFileRoute("/api/sessions/$id/api-requests/$requestId")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string; requestId: string}}) => {
				const {getDb} = await import("../../lib/db");
				const {readSessionApiRequestMessages} = await import("../../lib/session-api-requests");
				const {index} = getDb();
				return Response.json(
					ApiRequestMessagesSchema.parse(readSessionApiRequestMessages(index, params.id, params.requestId)),
					{headers: {"Cache-Control": "private, max-age=0, must-revalidate"}},
				);
			},
		}),
	},
});
