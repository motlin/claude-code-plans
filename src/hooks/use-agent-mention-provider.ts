import {useQueryClient} from "@tanstack/react-query";
import {useMemo} from "react";

import {agentMentionOptions, userAgentsQueryOptions} from "../lib/api/user-agents";
import type {MentionOption, MentionProvider} from "../lib/mention-options";

/**
 * The home draft's `@` Agents provider (upstream `pt`): the user's agents from the 30s-cached list, answered at once
 * once it has loaded; a failed lookup offers none. Picking one hands its name to `onPick` and leaves no chip.
 */
export function useAgentMentionProvider(onPick: (name: string) => void): MentionProvider
{
	const queryClient = useQueryClient();
	return useMemo<MentionProvider>(
		() => (
		{
			id: "ccp-agents",
			fetchOptions: (query): readonly MentionOption[] | Promise<readonly MentionOption[]> =>
			{
				const cached = queryClient.getQueryData(userAgentsQueryOptions.queryKey);
				if (cached === undefined)
					return queryClient.query(userAgentsQueryOptions).then(
						(response) => agentMentionOptions(response.agents, query),
						() => [],
					);
				queryClient.query(userAgentsQueryOptions).catch(() => undefined);
				return agentMentionOptions(cached.agents, query);
			},
			onSelect: (option) =>
			{
				onPick(option.id);
			},
		}),
		[queryClient, onPick],
	);
}
