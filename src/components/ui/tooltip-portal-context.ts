import {createContext} from "react";

/**
 * Whether tooltips under this provider portal to `document.body` by default. The transcript scroller sets it:
 * its `contain: strict` and `overflow-x: hidden` clip any tip drawn inside it at the column edge, so its tips
 * render over the viewport and shift inside its 8px edge instead (upstream's portaled cds Tooltip).
 */
export const TooltipPortalContext = createContext(false);
