import {useState} from "react";

import {nextRespondingHere, type RespondingHereSignal} from "../lib/responding-here";

/**
 * Whether this page watched the session's current turn (`nextRespondingHere`). It lives only in the mounted page,
 * as upstream's in-memory `pendingTurn`: a reload or a switch to another session starts false.
 */
export function useRespondingHere(sessionId: string, {status, sessionState, sending}: RespondingHereSignal): boolean
{
	const [held, setHeld] = useState(
		{
			sessionId,
			here: false,
		},
	);
	const prev = held.sessionId === sessionId && held.here;
	const here = nextRespondingHere(
		prev,
		{
			status,
			sessionState,
			sending,
		},
	);
	if (held.sessionId !== sessionId || held.here !== here)
	{
		setHeld(
			{
				sessionId,
				here,
			},
		);
	}
	return here;
}
