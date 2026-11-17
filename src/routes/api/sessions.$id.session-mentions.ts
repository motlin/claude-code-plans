import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {rejectCrossSite} from "../../lib/same-origin-guard";

const NO_STORE =
{
	"Cache-Control": "private, max-age=0, must-revalidate",
};

/**
 * Session `$id`'s sent session mentions. GET resolves them for the transcript's `@[Title]` chips; POST records the
 * ones a sent prompt carries (tracked chips, plus hand-typed titles that uniquely name a session).
 */
export const Route = createFileRoute("/api/sessions/$id/session-mentions")(
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
							{getArchivedSessionIds, getIndexedSessionIds},
							{getCacheDir},
							records,
							{ResolvedSessionMentionsResponseSchema},
						] = await Promise.all([
							import("../../lib/db"),
							import("../../lib/db/queries"),
							import("../../lib/db/connection"),
							import("../../lib/session-mention-records"),
							import("../../lib/mention-sessions"),
						]);
						const refs = await records.readSessionMentionRecords(getCacheDir(), params.id);
						const {index} = getDb();
						return Response.json(
							ResolvedSessionMentionsResponseSchema.parse(
								{
									mentions: records.resolveSessionMentions(
										refs,
										getIndexedSessionIds(
											index,
											refs.map((ref) => ref.sessionId),
										),
										getArchivedSessionIds(index),
									),
								},
							),
							{
								headers: NO_STORE,
							},
						);
					},
					POST: async ({
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
						const rejection = rejectCrossSite(request);
						if (rejection) return rejection;
						const [{getDb}, {listMentionRosterRows}, {getCacheDir}, sessions, {recordSessionMentions}] =
							await Promise.all([
								import("../../lib/db"),
								import("../../lib/db/queries"),
								import("../../lib/db/connection"),
								import("../../lib/mention-sessions"),
								import("../../lib/session-mention-records"),
							]);
						const body = sessions.SentSessionMentionsBodySchema.parse(await request.json());
						const roster = sessions.mentionSessionRoster(listMentionRosterRows(getDb().index), params.id);
						const mentions = sessions.collectSessionMentions(body.text, body.mentions, roster);
						await recordSessionMentions(getCacheDir(), params.id, mentions);
						return Response.json(
							{
								mentions,
							},
							{
								headers: NO_STORE,
							},
						);
					},
				},
			),
		},
	},
);
