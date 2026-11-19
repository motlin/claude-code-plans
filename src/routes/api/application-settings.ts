import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/application-settings")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async () =>
					{
						const [{handleGetApplicationSettings}, {getDb}, {getRoutines}, {liveSessionRoutines}] =
							await Promise.all([
								import("../../lib/application-settings-handler"),
								import("../../lib/db"),
								import("../../lib/db/routine-index"),
								import("../../lib/active-session-store"),
							]);
						// Upstream pins Scheduled for accounts with routines; locally, when the Scheduled list is non-empty.
						return handleGetApplicationSettings(
							undefined,
							{
								hasRoutines: () =>
									getRoutines(
										getDb().index,
										{
											now: Date.now(),
											liveSessions: liveSessionRoutines(),
										},
									).length > 0,
							},
						);
					},
					PUT: async ({request}: {request: Request}) =>
					{
						const {handlePutApplicationSettings} = await import("../../lib/application-settings-handler");
						return handlePutApplicationSettings(request);
					},
				},
			),
		},
	},
);
