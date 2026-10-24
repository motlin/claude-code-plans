import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

type HandlerContext = {params: {id: string}; request: Request};

/**
 * Dry-run (GET `?message=`) and run (POST `{message}`) a restore of the
 * session's files to how they were at a user message, through `claude --rewind-files`.
 */
export const Route = createFileRoute("/api/sessions/$id/rewind-files")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params, request}: HandlerContext) => {
				const {handleRewindFilesPreview} = await import("../../lib/rewind-preview");
				return handleRewindFilesPreview(params.id, request);
			},
			POST: async ({params, request}: HandlerContext) => {
				const {handleRewindFiles} = await import("../../lib/rewind-files");
				return handleRewindFiles(params.id, request);
			},
		}),
	},
});
