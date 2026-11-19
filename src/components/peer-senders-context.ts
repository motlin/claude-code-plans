import {createContext} from "react";

/** A local session that sent a peer message, as upstream's sessions store knows it (c19e90103 `_p`/`vp`). */
export interface PeerSender
{
	sessionId: string;
	title: string;
}

/** What the transcript knows about peer senders' sessions: upstream's sessions store plus its navigator. */
export interface PeerSenders
{
	hostSessionId: string;
	/** The session behind a message's `from` socket when it was sent, if the app knows it and its title. */
	lookup: (from: string, sentAt: string | undefined) => PeerSender | undefined;
	openSession: (sessionId: string) => void;
}

export const PeerSendersContext = createContext<PeerSenders | null>(null);
