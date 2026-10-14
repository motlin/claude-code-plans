import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionIdentityResponse} from "../../lib/api/sessions";
import {isBridgeSessionAlias, isSessionIdPrefix} from "../../lib/session-route-alias";

/** Remote Control URLs and short ID prefixes resolve to UUIDs here; all other session APIs keep their local IDs. */
export const Route = createFileRoute("/api/sessions/$id/identity")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const headers = {"Cache-Control": "private, max-age=0, must-revalidate"};
				const prefix = isSessionIdPrefix(params.id);
				if (!prefix && !isBridgeSessionAlias(params.id)) {
					return Response.json({error: "Session alias not found"}, {status: 404, headers});
				}
				const {getDb} = await import("../../lib/db");
				let owners: string[];
				if (prefix) {
					const {getSessionIdsByPrefix} = await import("../../lib/db/queries");
					owners = getSessionIdsByPrefix(getDb().index, params.id, 2);
				} else {
					const {getSessionBridgeOwners} = await import("../../lib/db/bridge-session-index");
					owners = getSessionBridgeOwners(getDb().index, params.id);
				}
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
