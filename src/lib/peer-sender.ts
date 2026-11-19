/**
 * A cross-session peer message names its sender by the CLI's messaging socket (`from="uds:<path>"`). The live
 * registry (`~/.claude/sessions/<pid>.json`) maps that socket to the sending session, the local analogue of
 * upstream's `from-session` attribute.
 */

/** A registry entry with a messaging socket, and the session's indexed title when it has one. */
export interface PeerSenderEntry
{
	messagingSocketPath: string;
	sessionId: string;
	/** When the CLI process started, in epoch milliseconds. */
	startedAt: number;
	title?: string | undefined;
}

const UDS_PREFIX = "uds:";

/** The socket path a `uds:` sender names, or undefined for any other sender. */
export function socketPathOf(from: string): string | undefined
{
	return from.startsWith(UDS_PREFIX) ? from.slice(UDS_PREFIX.length) : undefined;
}

/**
 * The registry entry that owned `from`'s socket when the message was sent. One started after the message is a
 * later process that reused the pid, and so the socket path.
 */
export function senderForSocket(
	entries: readonly PeerSenderEntry[],
	from: string,
	sentAt: string | undefined,
): PeerSenderEntry | undefined
{
	const socket = socketPathOf(from);
	if (socket === undefined) return undefined;
	const sent = sentAt === undefined ? Number.NaN : Date.parse(sentAt);
	return entries.find(
		(entry) => entry.messagingSocketPath === socket && (Number.isNaN(sent) || entry.startedAt <= sent),
	);
}
