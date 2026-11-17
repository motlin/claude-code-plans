import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/output-styles/validate")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					POST: async ({request}: {request: Request}) =>
					{
						const {handleOutputStyleValidate} = await import("../../lib/output-style-create");
						return handleOutputStyleValidate(request);
					},
				},
			),
		},
	},
);
