import {useId} from "react";

import {formatResetLabel, type RateLimitWindow} from "../lib/composer-state";

export function UsageMeter({percent, label}: {percent: number; label: string}) {
	const clamped = Math.min(100, Math.max(0, percent));
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(clamped)}
			className="h-1 w-full overflow-hidden rounded-r3 bg-alpha-1"
		>
			<div className="h-full rounded-r3 bg-accent-100" style={{width: `${clamped}%`}} />
		</div>
	);
}

/** cds Meter's fill: slid in from the inline start, never thinner than 4px. */
function meterFillTransform(percent: number): string {
	return `translateX(calc(var(--_meter-dir,-1) * (100% - min(100%, max(${percent}%, 4px)))))`;
}

/**
 * Upstream's 2026-10-20 popover row: label left, reset and percent right, over a 4px meter on an
 * alpha-2 track that names the row and describes it with the reset.
 */
export function UsagePopoverLimitRow({label, window}: {label: string; window: RateLimitWindow}) {
	const labelId = useId();
	const resetId = useId();
	const percent = Math.round(Math.min(100, Math.max(0, window.usedPercentage)));
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
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				aria-valuetext={`${percent}% used`}
				aria-labelledby={labelId}
				aria-describedby={resetId}
				className="relative h-1 w-full overflow-hidden rounded-full bg-alpha-2 forced-color-adjust-none"
			>
				{percent > 0 && (
					<div
						data-usage-bar-fill
						className="h-full w-full rounded-full bg-accent-100 transition-transform duration-200 ease-[cubic-bezier(.165,.84,.44,1)] motion-reduce:transition-none rtl:[--_meter-dir:1]"
						style={{transform: meterFillTransform(percent)}}
					/>
				)}
			</div>
		</div>
	);
}
