import {createContext} from "react";

export interface TranscriptMessageRef {
	sessionId: string;
	uuid: string;
}

/** Per-message transcript actions; an item whose action is absent renders disabled. */
export interface TranscriptActions {
	pinChapter?: (message: TranscriptMessageRef) => void;
	forkFrom?: (message: TranscriptMessageRef) => void;
	rewindTo?: (message: TranscriptMessageRef) => void;
	/** Why Rewind is unavailable right now (upstream: "Rewind is unavailable while Claude is working"). */
	rewindDisabledReason?: string;
}

export const TranscriptActionsContext = createContext<TranscriptActions>({});
