import {createContext, useContext} from "react";

/**
 * Upstream ca8b34310 `lu`: whether the pane's tile sits on the layout's right edge and not its left
 * one. Hosts outside the tiled layout (the expanded overlay, a page) keep the `false` default.
 */
export const TileRowEndContext = createContext(false);

export function useTileRowEnd(): boolean
{
	return useContext(TileRowEndContext);
}
