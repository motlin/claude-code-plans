import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {TranscriptResponse} from "../../lib/api/sessions";

/**
 * `?before=<index>` asks for the page of records ending just before that index
 * in the session's JSONL. Without it the endpoint serves the tail, which is the
 * only part of a long session the reader sees on first paint.
 */
function parseBefore(raw: string | null): number | undefined
{
	if (raw === null) return undefined;
	const before = Number.parseInt(raw, 10);
	if (!Number.isFinite(before) || before < 0) return undefined;
	return before;
}

/**
 * `?beforeUuid=<uuid>` asks for the page of records ending just before the line
 * carrying that uuid, and answers 404 `{found: false}` once the file no longer
 * has it, so the client can tell its window went stale. CLI uuids are 36
 * characters, so 64 leaves room without letting arbitrary text through.
 */
const BEFORE_UUID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/;

function transcriptResponse(transcript: unknown): Response
{
	return Response.json(
		TranscriptResponse.parse(transcript),
		{
			headers:
			{
				"Cache-Control": "private, max-age=0, must-revalidate",
			},
		},
	);
}

export const Route = createFileRoute("/api/sessions/$id/transcript")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({
						params,
						request,
					}: {
						params:
						{
							id: string;
						};
						request: Request;
					}) =>
					{
						const {getDb} = await import("../../lib/db");
						const {readStructuredTranscript, readStructuredTranscriptBefore} =
							await import("../../lib/structured-transcript");
						const {index} = getDb();
						const {searchParams} = new URL(request.url);
						const beforeUuid = searchParams.get("beforeUuid");
						if (beforeUuid !== null)
						{
							if (!BEFORE_UUID_PATTERN.test(beforeUuid))
							{
								return Response.json(
									{
										error: "invalid_before_uuid",
									},
									{
										status: 400,
									},
								);
							}
							const page = readStructuredTranscriptBefore(index, params.id, beforeUuid);
							if (page === undefined)
							{
								return Response.json(
									{
										found: false,
									},
									{
										status: 404,
									},
								);
							}
							return transcriptResponse(page);
						}
						const before = parseBefore(searchParams.get("before"));
						return transcriptResponse(
							readStructuredTranscript(
								index,
								params.id,
								{
									before,
								},
							),
						);
					},
				},
			),
		},
	},
);
