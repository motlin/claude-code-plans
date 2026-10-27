import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/home/folder-pr")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const {folderPrResponse} = await import("../../lib/folder-pr");
				return folderPrResponse(request);
			},
		}),
	},
});
