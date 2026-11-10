import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {HerdrTerminalIndexResponse} from "../../lib/api/herdr-terminals";

export const Route = createFileRoute("/api/herdr/terminals")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {getTerminalHost} = await import("../../lib/terminal-host");
				const workspaces = await (await getTerminalHost()).listTerminals();
				return Response.json(HerdrTerminalIndexResponse.parse({workspaces}), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
			POST: async ({request}: {request: Request}) => {
				const {getTerminalHost} = await import("../../lib/terminal-host");
				return (await getTerminalHost()).manageTerminal(request);
			},
		}),
	},
});
