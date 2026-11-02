import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {IndexingStatusResponse} from "../../lib/api/indexing";

export const Route = createFileRoute("/api/indexing-status")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async () =>
					{
						const {getIndexingStatus} = await import("../../lib/db/indexer");
						return Response.json(
							IndexingStatusResponse.parse(getIndexingStatus()),
							{
								headers:
								{
									"Cache-Control": "private, max-age=0, must-revalidate",
								},
							},
						);
					},
				},
			),
		},
	},
);
