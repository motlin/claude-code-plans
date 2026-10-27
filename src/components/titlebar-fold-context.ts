import {createContext, useContext} from "react";

/**
 * How many trail buttons the titlebar's measured fold hides in View options
 * (upstream's `hiddenCount`): the rail toggle first, then the main panes.
 */
export const TitlebarHiddenCountContext = createContext(0);

export function useTitlebarHiddenCount(): number {
	return useContext(TitlebarHiddenCountContext);
}
