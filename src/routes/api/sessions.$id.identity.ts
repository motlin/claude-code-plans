import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionIdentityResponse} from "../../lib/api/sessions";

/** Remote Control URLs resolve to UUIDs here; all other session APIs keep their local IDs. */
export const Route = createFileRoute("/api/sessions/$id/identity")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const headers = {"Cache-Control": "private, max-age=0, must-revalidate"};
				if (!/^session_[A-Za-z0-9_-]+$/.test(params.id)) {
					return Response.json({error: "Session alias not found"}, {status: 404, headers});
				}
				const {getDb} = await import("../../lib/db");
				const {getSessionBridgeOwners} = await import("../../lib/db/bridge-session-index");
				const owners = getSessionBridgeOwners(getDb().index, params.id);
				if (owners.length === 1) {
					return Response.json(SessionIdentityResponse.parse({sessionId: owners[0]}), {headers});
				}
				if (owners.length > 1) {
					return Response.json({error: "Session alias has multiple local owners"}, {status: 409, headers});
				}
				const {isCurrentlyIndexing} = await import("../../lib/db/indexer");
				if (isCurrentlyIndexing()) {
					return Response.json(
						{error: "Session index is still loading"},
						{status: 503, headers: {...headers, "Retry-After": "3"}},
					);
				}
				return Response.json({error: "Session alias not found"}, {status: 404, headers});
			},
		}),
	},
});
