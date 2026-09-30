import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

/**
 * The Files pane's workspace listing, rooted at the session's working
 * directory. Paths travel in the query string (`?dir=<rel>&q=<query>`)
 * because vp dev 404s dotted URL path segments.
 */
export const Route = createFileRoute("/api/sessions/$id/files")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params, request}: {params: {id: string}; request: Request}) => {
				const {handleSessionFilesRequest} = await import("../../lib/workspace-files-handler");
				return handleSessionFilesRequest(params.id, new URL(request.url).searchParams);
			},
		}),
	},
});
