import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionViewedStateSchema, ViewedStateMutationBodySchema} from "../../lib/api/viewed-state";
import {rejectCrossSite} from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/sessions/$id/viewed")({
	server: {
		handlers: withMethodNotAllowed({
			PUT: async ({params, request}: {params: {id: string}; request: Request}) => {
				const rejection = rejectCrossSite(request);
				if (rejection) return rejection;

				const [{getDb}, {applySessionViewedAction}, {broadcastTyped}] = await Promise.all([
					import("../../lib/db"),
					import("../../lib/session-viewed-action"),
					import("../../lib/sse-broadcast"),
				]);
				const body = ViewedStateMutationBodySchema.parse(await request.json());
				const viewedState = applySessionViewedAction({
					db: getDb().index,
					sessionId: params.id,
					action: body.action,
					...(body.messageIndex !== undefined ? {messageIndex: body.messageIndex} : {}),
					broadcast: broadcastTyped,
				});
				return Response.json(SessionViewedStateSchema.parse(viewedState), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
