import {createContext} from "react";

/**
 * Upstream `yv` sidebarHidden: true while the sidebar body is mounted but out of view (a collapsed sidebar's peek
 * not showing, or a closed phone sheet). Popups opened from inside it close on the rising edge.
 */
export const SidebarHiddenContext = createContext(false);
