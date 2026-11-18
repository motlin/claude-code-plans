import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/headless/launch")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					POST: async ({request}: {request: Request}) =>
					{
						const {handleHeadlessLaunch} = await import("../../lib/headless/launch");
						return handleHeadlessLaunch(request);
					},
				},
			),
		},
	},
);
