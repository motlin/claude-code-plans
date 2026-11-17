import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

/**
 * The home draft's `@` file feed, rooted at the chosen project folder. The
 * folder and query travel in the query string (`?cwd=<abs>&q=<query>`)
 * because vp dev 404s dotted URL path segments.
 */
export const Route = createFileRoute("/api/home/files")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({request}: {request: Request}) =>
					{
						const {handleFolderFilesRequest} = await import("../../lib/workspace-files-handler");
						const parameters = new URL(request.url).searchParams;
						return handleFolderFilesRequest(parameters.get("cwd") ?? "", parameters);
					},
				},
			),
		},
	},
);
