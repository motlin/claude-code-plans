import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/artifacts/$id/thumbnail")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({
						params,
					}: {
						params:
						{
							id: string;
						};
					}) =>
					{
						const {getDb} = await import("../../lib/db");
						const {getCacheDir} = await import("../../lib/db/connection");
						const {handleArtifactThumbnailRequest} = await import("../../lib/artifact-thumbnail");
						return handleArtifactThumbnailRequest(
							getDb().index,
							params.id,
							{
								cacheDir: getCacheDir(),
							},
						);
					},
				},
			),
		},
	},
);
