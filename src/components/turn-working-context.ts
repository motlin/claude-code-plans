import {createContext} from "react";

/**
 * The working turn's start in epoch ms (upstream `turnLive`, and the turn clock its busy rows count from);
 * null while the turn is not working or outside a live session page.
 */
export const TurnWorkingContext = createContext<number | null>(null);
