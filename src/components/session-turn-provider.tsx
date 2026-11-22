import type {ReactNode} from "react";

import {SessionRespondingContext} from "./session-responding-context";
import {TurnUndoSendContext} from "./turn-undo-send-context";

/** The session page's live-terminal send and responding state, shared by its transcript and its panes. */
export function SessionTurnProvider({
	send,
	responding,
	children,
}: {
	send: ((text: string) => void) | null;
	responding: boolean;
	children: ReactNode;
})
{
	return (
		<TurnUndoSendContext.Provider value={send}>
			<SessionRespondingContext.Provider value={responding}>{children}</SessionRespondingContext.Provider>
		</TurnUndoSendContext.Provider>
	);
}
