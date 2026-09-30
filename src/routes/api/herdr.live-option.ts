import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/herdr/live-option")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const {handleHerdrLiveOption} = await import("../../lib/herdr/live-option");
				return handleHerdrLiveOption(request);
			},
		}),
	},
});
