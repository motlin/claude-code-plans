import {usageRingSeverity, type UsageRingSeverity} from "../../lib/composer-state";

const USAGE_FILLS: Record<UsageRingSeverity, string> =
{
	normal: "bg-fill-accent",
	warning: "bg-usage-warning",
	critical: "bg-usage-danger",
};

/** Upstream c1564829c `G` = `L0(iv(pct))`: accent, warning at ≥75, danger at ≥90. */
export function usageFillClass(percent: number): string
{
	return USAGE_FILLS[usageRingSeverity(percent)];
}
