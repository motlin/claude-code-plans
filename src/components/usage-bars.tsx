import type {ReactNode} from "react";

/**
 * Upstream's usage-meter wrapper (chunk c37952aed, export `t`): a box-less `div.contents[data-usage-bars]` around
 * a surface's meters. Upstream also runs a one-time meter slide-in and severity crossfade behind a Growthbook
 * gate (`data-usage-bars-crossfade`); the gate is off on the live account, so only the inert wrapper is copied.
 */
export function UsageBars({surface, children}: {surface: "usage_page" | "popover"; children: ReactNode})
{
	return (
		<div className="contents" data-usage-bars={surface}>
			{children}
		</div>
	);
}
