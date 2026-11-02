/*
 * Upstream's chat-panel widths the rail docks at, alone and beside an open pane. Under the
 * panels flag it's the `Dg` fit (chat 320 + flat band 320 = 640 alone; 800 beside a pane);
 * the pre-panels `pA` rule was 611/771 (chat 320 + rail 280 + 13 inset − 2 slack; 760 + 11).
 */
const PANELS_FIT =
{
	alone: 640,
	besidePane: 800,
};
const LEGACY_FIT =
{
	alone: 611,
	besidePane: 771,
};

export type RailFit = "beside-pane" | "alone" | "none";

export function railFit(width: number, panels: boolean): RailFit
{
	const fit = panels ? PANELS_FIT : LEGACY_FIT;
	if (width >= fit.besidePane) return "beside-pane";
	return width >= fit.alone ? "alone" : "none";
}

export function railFits(fit: RailFit, hasPanes: boolean): boolean
{
	return hasPanes ? fit === "beside-pane" : fit !== "none";
}
