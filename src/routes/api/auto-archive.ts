import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/auto-archive")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {handleGetAutoArchive} = await import("../../lib/auto-archive-handler");
				return handleGetAutoArchive();
			},
			PUT: async ({request}: {request: Request}) => {
				const {handlePutAutoArchive} = await import("../../lib/auto-archive-handler");
				const {runAutoArchiveSweep} = await import("../../lib/auto-archive-service");
				return handlePutAutoArchive(request, undefined, () => {
					void runAutoArchiveSweep();
				});
			},
		}),
	},
});
