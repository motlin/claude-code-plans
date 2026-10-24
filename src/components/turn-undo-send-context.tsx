import {createContext} from "react";

/**
 * Sends a message to the session's live terminal, as the composer does. Upstream's turn
 * Undo asks Claude to undo the turn this way; null when the session has no live pane, and
 * the card falls back to the local direct revert behind a confirm.
 */
export const TurnUndoSendContext = createContext<((text: string) => void) | null>(null);
