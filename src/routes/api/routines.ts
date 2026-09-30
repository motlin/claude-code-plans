import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {RoutineListResponse} from "../../lib/api/routines";

export const Route = createFileRoute("/api/routines")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {getDb} = await import("../../lib/db");
				const {getRoutines} = await import("../../lib/db/routine-index");
				const {liveSessionRoutines} = await import("../../lib/active-session-store");

				const routines = getRoutines(getDb().index, {
					now: Date.now(),
					liveSessions: liveSessionRoutines(),
				});

				return Response.json(RoutineListResponse.parse(routines), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
