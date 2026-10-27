/** Upstream's chat-panel widths the 280px rail docks at: alone, and beside an open pane. */
const RAIL_FIT_ALONE_PX = 611;
const RAIL_FIT_BESIDE_PANE_PX = 771;

export type RailFit = "beside-pane" | "alone" | "none";

export function railFit(width: number): RailFit {
	if (width >= RAIL_FIT_BESIDE_PANE_PX) return "beside-pane";
	return width >= RAIL_FIT_ALONE_PX ? "alone" : "none";
}

export function railFits(fit: RailFit, hasPanes: boolean): boolean {
	return hasPanes ? fit === "beside-pane" : fit !== "none";
}
