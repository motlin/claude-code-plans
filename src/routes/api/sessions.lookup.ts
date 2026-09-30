import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionsByIdsResponse} from "../../lib/api/sessions";
import {invalidSessionStatusResponse, parseSessionStatusParam} from "../../lib/api/session-status-param";

/** Session rows for a comma-separated `ids` list, e.g. the pins this browser keeps. */
export const Route = createFileRoute("/api/sessions/lookup")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const url = new URL(request.url);
				const status = parseSessionStatusParam(url);
				if (status === null) return invalidSessionStatusResponse();
				const ids = (url.searchParams.get("ids") ?? "")
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean);

				const {getDb} = await import("../../lib/db");
				const {getSessionsByIds, getArchivedSessionIds} = await import("../../lib/db/queries");
				const {toSessionSummaryPayload} = await import("../../lib/session-summary");
				const {getUnseenSessionIds} = await import("../../lib/db/viewed-state");

				const {index} = getDb();
				const unseenIds = getUnseenSessionIds(index);
				const archivedIds = getArchivedSessionIds(index);
				const sessions = getSessionsByIds(index, ids, {status}).map((s) =>
					toSessionSummaryPayload(s, {
						unseen: unseenIds.has(s.id),
						archived: archivedIds.has(s.id),
					}),
				);

				return Response.json(SessionsByIdsResponse.parse(sessions), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
