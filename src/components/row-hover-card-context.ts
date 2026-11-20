import {createContext} from "react";

/**
 * Upstream shared-18 `ls`: true while the row's hover card can open, so the row's title keeps its own tooltip off
 * (`data-trigger-disabled`) and never opens over the card.
 */
export const RowHoverCardContext = createContext(false);
