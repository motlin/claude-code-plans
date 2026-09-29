import { type PaneKind, PaneKindSchema } from "./pane-layout";

export interface SessionSearch {
  /** A pane to open on arrival, e.g. `?pane=terminal` from "Open live terminal". */
  pane?: PaneKind;
}

/** `/session/$id` search params; an unknown pane is dropped rather than failing the route. */
export function validateSessionSearch(search: Record<string, unknown>): SessionSearch {
  const pane = PaneKindSchema.safeParse(search["pane"]);
  return pane.success ? { pane: pane.data } : {};
}
