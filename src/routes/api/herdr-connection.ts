import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {HerdrConnectionResponse} from "../../lib/api/herdr-connection";

export const Route = createFileRoute("/api/herdr-connection")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {herdrReconnectState} = await import("../../lib/herdr/reconnect-state");
				return Response.json(
					HerdrConnectionResponse.parse({reconnecting: herdrReconnectState.isReconnecting()}),
					{
						headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
					},
				);
			},
		}),
	},
});
