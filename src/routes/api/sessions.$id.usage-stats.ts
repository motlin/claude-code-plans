import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionUsageStatsSchema} from "../../lib/session-usage-stats";

/** The `/usage` card's session stats for a transcript, or 404 when the session isn't indexed. */
export async function handleUsageStatsRequest(transcriptPath: string | undefined): Promise<Response>
{
	if (transcriptPath === undefined)
		return new Response(
			"Session not found",
			{
				status: 404,
			},
		);
	const {readSessionUsageStatsMemoized} = await import("../../lib/session-usage-accumulator");
	return Response.json(
		SessionUsageStatsSchema.parse(await readSessionUsageStatsMemoized(transcriptPath)),
		{
			headers:
			{
				"Cache-Control": "private, max-age=0, must-revalidate",
			},
		},
	);
}

export const Route = createFileRoute("/api/sessions/$id/usage-stats")(
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
						const [{getDb}, {transcriptFilePath}] = await Promise.all([
							import("../../lib/db"),
							import("../../lib/structured-transcript"),
						]);
						return handleUsageStatsRequest(transcriptFilePath(getDb().index, params.id));
					},
				},
			),
		},
	},
);
