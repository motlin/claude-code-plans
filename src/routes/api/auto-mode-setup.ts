import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/auto-mode-setup")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({request}: {request: Request}) =>
					{
						const {handleAutoModeSetupGet, nodeAutoModeSetupDependencies} =
							await import("../../lib/auto-mode-setup-state");
						return handleAutoModeSetupGet(request, await nodeAutoModeSetupDependencies());
					},
				},
			),
		},
	},
);
