import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

/** Start a Shell tab: a login `$SHELL` PTY in the session folder, attached over `/api/shell/$ptyKey`. */
export const Route = createFileRoute("/api/sessions/$id/shell")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({params, request}: {params: {id: string}; request: Request}) => {
				const {handleCreateShellRequest} = await import("../../lib/shell-pty");
				return handleCreateShellRequest(request, params.id);
			},
		}),
	},
});
