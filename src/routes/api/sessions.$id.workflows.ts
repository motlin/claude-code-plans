import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionWorkflowRunsResponse} from "../../lib/api/sessions";

/** The session's workflow runs: launch, status, timing and per-agent progress. */
export const Route = createFileRoute("/api/sessions/$id/workflows")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import("../../lib/db");
				const {readSessionWorkflowRuns} = await import("../../lib/workflow-runs");
				const {index} = getDb();
				return Response.json(SessionWorkflowRunsResponse.parse(readSessionWorkflowRuns(index, params.id)), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
