import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/herdr/launch")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const {handleHerdrLaunch} = await import("../../lib/herdr/launch");
				return handleHerdrLaunch(request);
			},
		}),
	},
});
