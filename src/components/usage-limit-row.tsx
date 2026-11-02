import {useId} from "react";

import {formatResetLabel, type RateLimitWindow} from "../lib/composer-state";
import {usageVariant, type UsageVariant} from "../lib/usage";

/** cds Meter's `bg-fill-<variant>`; the popover pins every variant's track to alpha-2. */
const FILL_CLASS =
{
	accent: "bg-accent-100",
	warning: "bg-usage-warning",
	danger: "bg-usage-danger",
} as const satisfies Record<UsageVariant, string>;

/** cds Meter's fill: slid in from the inline start, never thinner than 4px. */
function meterFillTransform(percent: number): string
{
	return `translateX(calc(var(--_meter-dir,-1) * (100% - min(100%, max(${percent}%, 4px)))))`;
}

/**
 * Upstream's 2026-10-20 popover row: label left, reset and percent right, over a 4px meter on an
 * alpha-2 track (inset alpha-1 ring) that names the row and describes it with the reset. The fill
 * takes upstream's `wV` severity: warning at 75%, danger at 90%.
 */
export function UsagePopoverLimitRow({label, window}: {label: string; window: RateLimitWindow})
{
	const labelId = useId();
	const resetId = useId();
	const percent = Math.round(Math.min(100, Math.max(0, window.usedPercentage)));
	const variant = usageVariant(percent);
	return (
		<div className="flex flex-col gap-1">
			<div data-usage-row className="flex flex-wrap items-baseline justify-between gap-x-2 text-[12px]/[15px]">
				<span id={labelId} className="text-primary">
					{label}
				</span>
				<span className="ms-auto flex items-baseline gap-1.5 tabular-nums text-ink-muted">
					<span id={resetId}>{formatResetLabel(window.resetsAt, Date.now())}</span>
					<span aria-hidden="true">{percent}%</span>
				</span>
			</div>
			<div
				role="meter"
				data-variant={variant}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				aria-valuetext={`${percent}% used`}
				aria-labelledby={labelId}
				aria-describedby={resetId}
				className="relative h-1 w-full overflow-hidden rounded-full bg-alpha-2 shadow-[inset_0_0_0_1px_var(--color-alpha-1)] forced-color-adjust-none"
			>
				{percent > 0 && (
					<div
						data-usage-bar-fill
						className={`h-full w-full rounded-full ${FILL_CLASS[variant]} transition-transform duration-200 ease-[cubic-bezier(.165,.84,.44,1)] motion-reduce:transition-none rtl:[--_meter-dir:1]`}
						style={
						{
							transform: meterFillTransform(percent),
						}}
					/>
				)}
			</div>
		</div>
	);
}
