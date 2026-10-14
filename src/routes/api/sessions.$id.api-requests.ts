import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {ApiRequestLogSchema} from "../../lib/api-request-log";

/** The session's API request log (CLI 2.1.300+), fetched when a Request disclosure opens. */
export const Route = createFileRoute("/api/sessions/$id/api-requests")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import("../../lib/db");
				const {readSessionApiRequestLog} = await import("../../lib/session-api-requests");
				const {index} = getDb();
				return Response.json(ApiRequestLogSchema.parse(readSessionApiRequestLog(index, params.id)), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
