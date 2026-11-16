import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionMcpStatusResponse} from "../../lib/api/sessions";
import {isFailedMcpSnapshot, readSessionMcpStatus} from "../../lib/session-mcp-status";

/**
 * The MCP servers the session failed to connect, from its transcript's last
 * full deferred-tools delta: the rail Connectors card's "Reconnect" rows.
 */
export const Route = createFileRoute("/api/sessions/$id/mcp-status")(
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
						const [{getDb}, {transcriptFilePath}, {forEachTranscriptLine}] = await Promise.all([
							import("../../lib/db"),
							import("../../lib/structured-transcript"),
							import("../../lib/transcript-stream"),
						]);
						const filePath = transcriptFilePath(getDb().index, params.id);
						let snapshot: unknown;
						if (filePath !== undefined)
						{
							try
							{
								await forEachTranscriptLine(filePath, (line) =>
								{
									if (!line.includes('"failedMcpServers"')) return;
									try
									{
										const record = JSON.parse(line) as unknown;
										if (isFailedMcpSnapshot(record)) snapshot = record;
									}
									catch
									{
										// a malformed line holds no snapshot
									}
								});
							}
							catch
							{
								// an unreadable transcript reports no failures
							}
						}
						return Response.json(
							SessionMcpStatusResponse.parse(
								readSessionMcpStatus(snapshot === undefined ? [] : [snapshot]),
							),
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
