import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {ProjectSessionListResponse} from "../../lib/api/projects";
import {invalidSessionStatusResponse, parseSessionStatusParam} from "../../lib/api/session-status-param";

/** A project's sessions as the same summary rows `/api/sessions/grouped` serves, so every session list draws one row. */
export const Route = createFileRoute("/api/projects/$id/sessions")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({
						params,
						request,
					}: {
						params:
						{
							id: string;
						};
						request: Request;
					}) =>
					{
						const status = parseSessionStatusParam(new URL(request.url));
						if (status === null) return invalidSessionStatusResponse();
						const {getDb} = await import("../../lib/db");
						const {listSessionsForProjectFromDb, getArchivedSessionIds} =
							await import("../../lib/db/queries");
						const {toSessionSummaryPayload} = await import("../../lib/session-summary");
						const {getSessionTerminalHosts} = await import("../../lib/session-terminal-hosts");
						const {getUnseenSessionIds} = await import("../../lib/db/viewed-state");

						const {index} = getDb();
						const unseenIds = getUnseenSessionIds(index);
						const archivedIds = getArchivedSessionIds(index);
						const terminalHosts = getSessionTerminalHosts();
						const sessions = listSessionsForProjectFromDb(
							index,
							params.id,
							{
								status,
							},
						).map((s) =>
							toSessionSummaryPayload(
								s,
								{
									unseen: unseenIds.has(s.id),
									archived: archivedIds.has(s.id),
									terminalHost: terminalHosts.get(s.id) ?? null,
								},
							),
						);

						return Response.json(
							ProjectSessionListResponse.parse(sessions),
							{
								headers:
								{
									"Cache-Control": "private, max-age=0, must-revalidate",
								},
							},
						);
					},
				},
			),
		},
	},
);
