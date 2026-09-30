import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {ArchivedMutationResponse} from "../../lib/api/sessions";
import {rejectCrossSite} from "../../lib/same-origin-guard";

type HandlerContext = {params: {id: string}; request: Request};

function archiveHandler(archived: boolean) {
	return async ({params, request}: HandlerContext) => {
		const rejection = rejectCrossSite(request);
		if (rejection) return rejection;

		const {getDb} = await import("../../lib/db");
		const {applySessionArchiveAction} = await import("../../lib/session-archive");
		const {broadcastTyped} = await import("../../lib/sse-broadcast");
		const result = applySessionArchiveAction({
			db: getDb().index,
			sessionId: params.id,
			archived,
			broadcast: broadcastTyped,
		});
		return Response.json(ArchivedMutationResponse.parse({archived: result}), {
			headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
		});
	};
}

export const Route = createFileRoute("/api/sessions/$id/archived")({
	server: {
		handlers: withMethodNotAllowed({
			PUT: archiveHandler(true),
			DELETE: archiveHandler(false),
		}),
	},
});
