import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/home/folder-status")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const {folderStatusResponse} = await import("../../lib/folder-git-status");
				return folderStatusResponse(request);
			},
		}),
	},
});
