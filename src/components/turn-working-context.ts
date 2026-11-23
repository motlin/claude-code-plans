import {createContext} from "react";

/** Whether the session's turn is working (upstream `turnLive`); false outside a live session page. */
export const TurnWorkingContext = createContext(false);
