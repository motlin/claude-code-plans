import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {HerdrWorkspaceIndexResponse} from "../../lib/api/herdr-workspaces";

export const Route = createFileRoute("/api/herdr-workspaces")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {getTerminalHost} = await import("../../lib/terminal-host");
				const workspaces = await (await getTerminalHost()).listWorkspaces();
				return Response.json(HerdrWorkspaceIndexResponse.parse({workspaces}), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
