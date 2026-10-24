import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/open-file")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const {handleOpenFile} = await import("../../lib/open-in-finder");
				return handleOpenFile(request);
			},
		}),
	},
});
