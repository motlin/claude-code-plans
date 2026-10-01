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

/** A plan limit: label, reset time and percent, over its bar. */
export function UsageLimitRow({label, window}: {label: string; window: RateLimitWindow}) {
	const percent = Math.round(window.usedPercentage);
	return (
		<div className="flex flex-col gap-1">
			<div data-usage-row className="flex items-baseline gap-2">
				<span className="text-primary">{label}</span>
				<span className="text-t6">{formatResetLabel(window.resetsAt, Date.now())}</span>
				<span className="ms-auto tabular-nums text-secondary">{percent}%</span>
			</div>
			<UsageMeter percent={window.usedPercentage} label={label} />
		</div>
	);
}
