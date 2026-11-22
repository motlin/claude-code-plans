import {createContext} from "react";

/**
 * Whether the session page's turn is in progress (upstream `isResponding`), for panes outside the transcript such as
 * the Changes findings bar, which disables Re-run review and shimmers "Applying fixes…" while it holds.
 */
export const SessionRespondingContext = createContext(false);
