import {usageRingSeverity, type UsageRingSeverity} from "../../lib/composer-state";

const USAGE_FILLS: Record<UsageRingSeverity, string> =
{
	normal: "bg-fill-accent",
	warning: "bg-usage-warning forced-colors:bg-[color:Highlight]",
	critical: "bg-usage-danger",
};

/** Upstream c1564829c `G` = `L0(iv(pct))`: accent, warning at ≥75, danger at ≥90. */
export function usageFillClass(percent: number): string
{
	return USAGE_FILLS[usageRingSeverity(percent)];
}

/** Upstream `le` bar root: a 4px track that stays visible in forced-colors mode. */
export const CONTEXT_BAR_TRACK_CLASS =
	"h-[4px] rounded-full overflow-hidden forced-color-adjust-none forced-colors:!bg-[color:Canvas] forced-colors:outline forced-colors:outline-[color:CanvasText]";
