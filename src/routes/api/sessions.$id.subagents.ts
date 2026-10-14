import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionSubagentsResponse} from "../../lib/api/sessions";

export const Route = createFileRoute("/api/sessions/$id/subagents")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import("../../lib/db");
				const {sessionSubagentsWithStops} = await import("../../lib/db/subagent-stops");

				const {index} = getDb();
				const agents = sessionSubagentsWithStops(index, params.id);

				return Response.json(SessionSubagentsResponse.parse(agents), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
