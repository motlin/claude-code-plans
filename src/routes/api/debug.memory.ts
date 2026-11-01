import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/debug/memory")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const [{collectMemoryStats}, {getDb}] = await Promise.all([
					import("../../lib/api/debug-memory"),
					import("../../lib/db"),
				]);
				return Response.json(collectMemoryStats(getDb()), {headers: {"Cache-Control": "no-store"}});
			},
		}),
	},
});
