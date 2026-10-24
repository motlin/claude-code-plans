import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

/** Restore the session's files to how they were at a user message, through `claude --rewind-files`. */
export const Route = createFileRoute("/api/sessions/$id/rewind-files")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({params, request}: {params: {id: string}; request: Request}) => {
				const {handleRewindFiles} = await import("../../lib/rewind-files");
				return handleRewindFiles(params.id, request);
			},
		}),
	},
});
