import {useQueryClient} from "@tanstack/react-query";
import {useMemo} from "react";

import
{
	mentionSessionsQueryOptions,
	postSentSessionMentions,
	sessionMentionsQueryOptions,
} from "../lib/api/session-mentions";
import type {MentionOption, MentionProvider} from "../lib/mention-options";
import {mentionSessionOptions, trackedSessionMentions} from "../lib/mention-sessions";

const SENT_MENTION = /@\[[^\][\n]{1,120}\]/;

/**
 * The session composer's `@` Sessions provider: other sessions from the cached roster, answered at once once it has
 * loaded (skeleton rows while the first load runs). A send that carries `@[Title]` mentions records them for the
 * transcript's chips.
 */
export function useSessionMentionProvider(sessionId: string): MentionProvider
{
	const queryClient = useQueryClient();
	return useMemo(() =>
	{
		const options = mentionSessionsQueryOptions(sessionId);
		return {
			id: "ccp-sessions",
			fetchOptions: (query): readonly MentionOption[] | Promise<readonly MentionOption[]> =>
			{
				const cached = queryClient.getQueryData(options.queryKey);
				if (cached === undefined)
					return queryClient.query(options).then(
						(roster) => mentionSessionOptions(roster.sessions, query),
						() => [],
					);
				// A roster older than its 30s stale time refreshes behind the cached answer.
				queryClient.query(options).catch(() => undefined);
				return mentionSessionOptions(cached.sessions, query);
			},
			pending: () => (
			{
				rows: 3,
			}),
			onSent: (text, mentions) =>
			{
				if (!SENT_MENTION.test(text)) return;
				void postSentSessionMentions(sessionId, text, trackedSessionMentions(mentions)).then(
					async () => queryClient.invalidateQueries(sessionMentionsQueryOptions(sessionId)),
					() => undefined,
				);
			},
		};
	}, [queryClient, sessionId]);
}
