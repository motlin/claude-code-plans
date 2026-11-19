import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {PeerSendersResponse} from "../../lib/api/peer-senders";

export const Route = createFileRoute("/api/sessions/peer-senders")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({request}: {request: Request}) =>
					{
						const {getDb} = await import("../../lib/db");
						const {getSessionTitlesByIds} = await import("../../lib/db/queries");
						const {readSessionRegistry} = await import("../../lib/session-registry");

						const sockets = new Set(
							(new URL(request.url).searchParams.get("sockets") ?? "")
								.split(",")
								.map((socket) => socket.trim())
								.filter(Boolean),
						);
						const entries = (await readSessionRegistry()).filter(
							(entry) =>
								entry.messagingSocketPath !== undefined && sockets.has(entry.messagingSocketPath),
						);
						const titles = getSessionTitlesByIds(
							getDb().index,
							entries.map((entry) => entry.sessionId),
						);

						return Response.json(
							PeerSendersResponse.parse(
								{
									senders: entries.map((entry) => (
									{
										messagingSocketPath: entry.messagingSocketPath,
										sessionId: entry.sessionId,
										startedAt: entry.startedAt,
										...(titles[entry.sessionId] !== undefined &&
										{
											title: titles[entry.sessionId],
										}),
									})),
								},
							),
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
