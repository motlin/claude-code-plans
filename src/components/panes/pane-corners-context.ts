import {createContext} from "react";

/** Whether the pane's tile sits in the tiles' top-left / top-right corner (upstream `Hn`'s clearance flags). */
export interface PaneCorners
{
	topLeft: boolean;
	topRight: boolean;
}

/** Provided by the tile host around each pane; outside one, a header touches no corner. */
export const PaneCornersContext = createContext<PaneCorners>(
	{
		topLeft: false,
		topRight: false,
	},
);
