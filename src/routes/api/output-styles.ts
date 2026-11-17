import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/output-styles")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({request}: {request: Request}) =>
					{
						const {handleOutputStylesGet} = await import("../../lib/output-styles");
						return handleOutputStylesGet(request);
					},
					POST: async ({request}: {request: Request}) =>
					{
						const {handleOutputStyleCreate} = await import("../../lib/output-style-create");
						return handleOutputStyleCreate(request);
					},
				},
			),
		},
	},
);
