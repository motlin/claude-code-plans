import {useQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {type ReactNode, useMemo} from "react";

import {parsePeerMessage} from "../lib/agent-message";
import {peerSendersQueryOptions} from "../lib/api/peer-senders";
import {senderForSocket, socketPathOf} from "../lib/peer-sender";
import type {SessionLine} from "../lib/transcript";
import {type PeerSenders, PeerSendersContext} from "./peer-senders-context";

function lineText(line: SessionLine): string
{
	if (line.type !== "user") return "";
	const content = line.message?.content;
	if (typeof content === "string") return content;
	return (content ?? []).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

/** The messaging sockets of the transcript's cross-session senders, comma-joined and sorted. */
function peerSocketsKey(lines: readonly SessionLine[]): string
{
	const sockets = new Set<string>();
	for (const line of lines)
	{
		if (line.type !== "user" || line.peerOrigin === undefined) continue;
		const from = parsePeerMessage(lineText(line), line.peerOrigin)?.from;
		const socket = from === undefined ? undefined : socketPathOf(from);
		if (socket !== undefined) sockets.add(socket);
	}
	return [...sockets].toSorted().join(",");
}

/**
 * Resolves the transcript's cross-session senders to their local sessions through the CLI registry, so a peer
 * row can head itself with the sender session's title and open it (upstream's sessions store and navigator).
 */
export function PeerSendersProvider({
	sessionId,
	lines,
	children,
}: {
	sessionId: string;
	lines: readonly SessionLine[];
	children: ReactNode;
})
{
	const navigate = useNavigate();
	const socketsKey = peerSocketsKey(lines);
	const sockets = useMemo(() => (socketsKey === "" ? [] : socketsKey.split(",")), [socketsKey]);
	const {data} = useQuery(peerSendersQueryOptions(sockets));
	const value = useMemo<PeerSenders>(
		() => (
		{
			hostSessionId: sessionId,
			lookup: (from, sentAt) =>
			{
				const entry = senderForSocket(data?.senders ?? [], from, sentAt);
				return entry?.title === undefined
					? undefined
					:
						{
							sessionId: entry.sessionId,
							title: entry.title,
						};
			},
			openSession: (id) =>
			{
				void navigate(
					{
						to: "/session/$id",
						params:
						{
							id,
						},
					},
				);
			},
		}),
		[sessionId, data, navigate],
	);
	return <PeerSendersContext.Provider value={value}>{children}</PeerSendersContext.Provider>;
}
