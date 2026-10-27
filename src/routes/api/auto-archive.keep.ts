import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/auto-archive/keep")({
	server: {
		handlers: withMethodNotAllowed({
			PUT: async ({request}: {request: Request}) => {
				const {handlePutKeptSessions} = await import("../../lib/auto-archive-handler");
				const {reportKeptSessions} = await import("../../lib/auto-archive-service");
				return handlePutKeptSessions(request, reportKeptSessions);
			},
		}),
	},
});
