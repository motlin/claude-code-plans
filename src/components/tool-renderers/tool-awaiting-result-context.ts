import {createContext} from "react";

/**
 * Upstream `xu`: the row's call is in flight and not held by a permission prompt, so a generic body with no
 * output yet says "Waiting for the result". Locally "in flight" is a call whose result hasn't arrived.
 */
export const ToolAwaitingResultContext = createContext(false);
