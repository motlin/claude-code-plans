import {createContext, useContext} from "react";

/** The session titlebar is narrow enough that its origin pills collapse and the rail toggle folds into View options. */
export const TitlebarCompactContext = createContext(false);

export function useTitlebarCompact(): boolean {
	return useContext(TitlebarCompactContext);
}
