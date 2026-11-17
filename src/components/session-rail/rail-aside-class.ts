import {createContext} from "react";

/** The docked rail's own size: the column's height at the rail width. */
const DOCKED_RAIL_ASIDE_CLASS = "h-full w-[var(--session-rail-w,17.5rem)]";

/**
 * Upstream `pJ` passes `className="h-full w-full rounded-[inherit]"` to the rail it raises,
 * so the aside fills the card; the docked rail keeps its own width. A context, since the
 * overlay only holds the caller's `render`.
 */
export const RailAsideClassContext = createContext(DOCKED_RAIL_ASIDE_CLASS);
