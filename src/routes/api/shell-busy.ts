import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

/** Which Shell tabs are still running a foreground command, for the close guard. */
export const Route = createFileRoute("/api/shell-busy")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const {handleShellBusyRequest} = await import("../../lib/shell-pty");
				return handleShellBusyRequest(request);
			},
		}),
	},
});
