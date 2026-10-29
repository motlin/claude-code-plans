import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/herdr/elicitation")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const {getTerminalHost} = await import("../../lib/terminal-host");
				return (await getTerminalHost()).readElicitationDialog(request);
			},
			POST: async ({request}: {request: Request}) => {
				const {getTerminalHost} = await import("../../lib/terminal-host");
				return (await getTerminalHost()).answerElicitation(request);
			},
		}),
	},
});
