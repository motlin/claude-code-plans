import {type PaneKind, PaneKindSchema} from "./pane-layout";

export interface SessionSearch
{
	/** A pane to open on arrival, e.g. `?pane=terminal` from "Open live terminal". */
	pane?: PaneKind;
	/** Upstream's `?view=terminal`: the read-only terminal transcript view in place of the session column. */
	view?: "terminal";
}

/** `/session/$id` search params; an unknown pane or view is dropped rather than failing the route. */
export function validateSessionSearch(search: Record<string, unknown>): SessionSearch
{
	const result: SessionSearch = {};
	const pane = PaneKindSchema.safeParse(search["pane"]);
	if (pane.success) result.pane = pane.data;
	if (search["view"] === "terminal") result.view = "terminal";
	return result;
}
