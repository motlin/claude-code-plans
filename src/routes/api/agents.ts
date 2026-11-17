import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

/** The user's own agents in `~/.claude/agents`, for the home draft's `@` Agents rows. */
export const Route = createFileRoute("/api/agents")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async () =>
					{
						const [{readUserAgents}, {UserAgentsResponseSchema}] = await Promise.all([
							import("../../lib/user-agents"),
							import("../../lib/api/user-agents"),
						]);
						return Response.json(
							UserAgentsResponseSchema.parse(
								{
									agents: await readUserAgents(),
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
