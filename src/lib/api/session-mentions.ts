import {queryOptions} from "@tanstack/react-query";

import
{
	MentionSessionsResponseSchema,
	ResolvedSessionMentionsResponseSchema,
	type SessionMentionRef,
} from "../mention-sessions";
import {apiFetch} from "./client";

/** Upstream caches the `@` roster for 30s. */
const ROSTER_STALE_MS = 30_000;

/** The `@` Sessions roster for session `sessionId`'s composer. */
export function mentionSessionsQueryOptions(sessionId: string)
{
	return queryOptions(
		{
			queryKey: ["mention-sessions", sessionId],
			queryFn: async ({signal}) =>
				apiFetch(
					`/api/sessions/${encodeURIComponent(sessionId)}/mention-sessions`,
					MentionSessionsResponseSchema,
					{
						signal,
					},
				),
			staleTime: ROSTER_STALE_MS,
		},
	);
}

/** Session `sessionId`'s sent session mentions, resolved for its transcript chips. */
export function sessionMentionsQueryOptions(sessionId: string)
{
	return queryOptions(
		{
			queryKey: ["session-mentions", sessionId],
			queryFn: async ({signal}) =>
				apiFetch(
					`/api/sessions/${encodeURIComponent(sessionId)}/session-mentions`,
					ResolvedSessionMentionsResponseSchema,
					{
						signal,
					},
				),
		},
	);
}

/** Records the session mentions a sent prompt carries; the server vouches for hand-typed ones. */
export async function postSentSessionMentions(
	sessionId: string,
	text: string,
	mentions: readonly SessionMentionRef[],
): Promise<void>
{
	await fetch(
		`/api/sessions/${encodeURIComponent(sessionId)}/session-mentions`,
		{
			method: "POST",
			headers:
			{
				"Content-Type": "application/json",
			},
			body: JSON.stringify(
				{
					text,
					mentions,
				},
			),
		},
	);
}
