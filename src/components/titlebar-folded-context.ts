import {createContext, useContext} from "react";

/** The chat tile is squeezed to 320px or narrower, so the trail's rail, Changes and Files toggles fold into View options. */
export const TitlebarFoldedContext = createContext(false);

export function useTitlebarFolded(): boolean {
	return useContext(TitlebarFoldedContext);
}
