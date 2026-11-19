import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";

import {apiFetch} from "./client";

export const PeerSendersResponse = z.object(
	{
		senders: z.array(
			z.object(
				{
					messagingSocketPath: z.string(),
					sessionId: z.string(),
					startedAt: z.number(),
					title: z.string().optional(),
				},
			),
		),
	},
);

/** The registry entries that own these messaging sockets, with their sessions' indexed titles. */
export const peerSendersQueryOptions = (sockets: readonly string[]) =>
	queryOptions(
		{
			queryKey: ["peer-senders", sockets.toSorted()] as const,
			queryFn: async () =>
				apiFetch(
					`/api/sessions/peer-senders?sockets=${encodeURIComponent(sockets.toSorted().join(","))}`,
					PeerSendersResponse,
				),
			enabled: sockets.length > 0,
			staleTime: Infinity,
		},
	);
