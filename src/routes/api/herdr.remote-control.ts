import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/herdr/remote-control")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const {getTerminalHost} = await import("../../lib/terminal-host");
				return (await getTerminalHost()).toggleRemoteControl(request);
			},
		}),
	},
});
