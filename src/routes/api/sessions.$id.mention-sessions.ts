import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

/** The `@` Sessions provider's roster for the composer of session `$id`: every other mentionable session, newest first. */
export const Route = createFileRoute("/api/sessions/$id/mention-sessions")(
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
						const [
							{getDb},
							{listMentionRosterRows},
							{mentionSessionRoster, MentionSessionsResponseSchema},
						] = await Promise.all([
							import("../../lib/db"),
							import("../../lib/db/queries"),
							import("../../lib/mention-sessions"),
						]);
						return Response.json(
							MentionSessionsResponseSchema.parse(
								{
									sessions: mentionSessionRoster(listMentionRosterRows(getDb().index), params.id),
								},
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
