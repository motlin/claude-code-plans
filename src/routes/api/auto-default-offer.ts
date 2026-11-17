import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/auto-default-offer")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async () =>
					{
						const {handleAutoDefaultOfferGet, nodeAutoDefaultOfferDependencies} =
							await import("../../lib/auto-default-offer-server");
						return handleAutoDefaultOfferGet(await nodeAutoDefaultOfferDependencies());
					},
					POST: async ({request}: {request: Request}) =>
					{
						const {handleAutoDefaultOfferPost, nodeAutoDefaultOfferDependencies} =
							await import("../../lib/auto-default-offer-server");
						return handleAutoDefaultOfferPost(request, await nodeAutoDefaultOfferDependencies());
					},
				},
			),
		},
	},
);
