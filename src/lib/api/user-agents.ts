import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";

import type {MentionOption} from "../mention-options";
import {apiFetch} from "./client";

const UserAgentSchema = z
	.object(
		{
			name: z.string(),
			description: z.string().optional(),
		},
	)
	.strict();
export type UserAgent = z.infer<typeof UserAgentSchema>;

export const UserAgentsResponseSchema = z
	.object(
		{
			agents: z.array(UserAgentSchema),
		},
	)
	.strict();

/** Upstream caches the agents list for 30s (`["epitaxy","agents",null]`). */
export const userAgentsQueryOptions = queryOptions(
	{
		queryKey: ["user-agents"],
		queryFn: async ({signal}) =>
			apiFetch(
				"/api/agents",
				UserAgentsResponseSchema,
				{
					signal,
				},
			),
		staleTime: 30_000,
	},
);

/** Upstream's agents cap. */
const AGENT_LIMIT = 10;

/** Upstream `pt`: agents whose lowercased name holds the lowercased query (all for an empty one), at most 10. */
export function agentMentionOptions(agents: readonly UserAgent[], query: string): MentionOption[]
{
	const needle = query.toLowerCase();
	return agents
		.filter((agent) => agent.name.toLowerCase().includes(needle))
		.slice(0, AGENT_LIMIT)
		.map((agent) => (
		{
			id: agent.name,
			providerId: "ccp-agents",
			label: agent.name,
			...(agent.description === undefined || agent.description === ""
				? {}
				:
					{
						description: agent.description,
					}),
			renderedText: agent.name,
			category: "Agents",
			kind: "agent",
		}));
}
