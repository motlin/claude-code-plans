import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionStatusInfoResponse} from "../../lib/api/sessions";

/** The `/status` card's server inputs for a transcript, or 404 when the session isn't indexed. */
export async function handleStatusInfoRequest(transcriptPath: string | undefined, home: string): Promise<Response>
{
	if (transcriptPath === undefined)
		return new Response(
			"Session not found",
			{
				status: 404,
			},
		);
	const {readSessionStatusInfo} = await import("../../lib/session-status-info");
	return Response.json(
		SessionStatusInfoResponse.parse(
			await readSessionStatusInfo(
				transcriptPath,
				{
					home,
				},
			),
		),
		{
			headers:
			{
				"Cache-Control": "private, max-age=0, must-revalidate",
			},
		},
	);
}

export const Route = createFileRoute("/api/sessions/$id/status-info")(
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
						const [{getDb}, {transcriptFilePath}, {homedir}] = await Promise.all([
							import("../../lib/db"),
							import("../../lib/structured-transcript"),
							import("node:os"),
						]);
						return handleStatusInfoRequest(transcriptFilePath(getDb().index, params.id), homedir());
					},
				},
			),
		},
	},
);
