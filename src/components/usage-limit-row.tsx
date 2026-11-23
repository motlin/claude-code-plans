import {useId} from "react";

import {usageVariant, type UsageVariant} from "../lib/usage";

/** cds Meter's track, `bg-<variant>` (`--cds-bg-accent` is the accent at 12% under fizzy color). */
const TRACK_CLASS =
{
	accent: "bg-upstream-accent-pressed",
	warning: "bg-usage-track-warning",
	danger: "bg-usage-track-danger",
} as const satisfies Record<UsageVariant, string>;

/** cds Meter's fill, `bg-fill-<variant>`. */
const FILL_CLASS =
{
	accent: "bg-fill-accent",
	warning: "bg-usage-warning",
	danger: "bg-usage-danger",
} as const satisfies Record<UsageVariant, string>;

/** cds Meter's `forced-colors` paint: a Canvas track outlined in CanvasText. */
const FORCED_COLORS_CLASS =
	"forced-color-adjust-none forced-colors:bg-[color:Canvas] forced-colors:outline forced-colors:outline-[color:CanvasText]";

/** cds Meter's fill: slid in from the inline start, never thinner than 8px, or 4px at `size="sm"`. */
function meterFillTransform(percent: number, size: "default" | "sm"): string
{
	const minimum = size === "sm" ? 4 : 8;
	return `translateX(calc(var(--_meter-dir, -1) * (100% - min(100%, max(${percent.toFixed(1)}%, ${minimum}px)))))`;
}

/**
 * Upstream's cds Meter (`mf.Root`): a `w-full` wrapper (here carrying `className`) around an 8px meter,
 * or 4px at `size="sm"`, on a `bg-<variant>` track (`bg-neutral` while an accent meter is empty) with an
 * inset alpha-1 ring. The fill takes the variant; at 0 it isn't drawn.
 */
export function UsageMeter({
	percent,
	variant,
	size = "default",
	labelledBy,
	describedBy,
	valueText,
	className = "w-full",
}: {
	percent: number;
	variant: UsageVariant;
	size?: "default" | "sm";
	labelledBy: string;
	describedBy?: string | undefined;
	valueText: string;
	className?: string;
})
{
	const track = percent === 0 && variant === "accent" ? "bg-neutral" : TRACK_CLASS[variant];
	return (
		<div data-cds="Meter" data-variant={variant} className={className}>
			<div
				role="meter"
				data-variant={variant}
				data-size={size === "sm" ? "sm" : undefined}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				aria-valuetext={valueText}
				aria-labelledby={labelledBy}
				aria-describedby={describedBy}
				className={`w-full overflow-hidden rounded-full ${FORCED_COLORS_CLASS} ${size === "sm" ? "h-1" : "h-2"} ${track}`}
				style={
				{
					boxShadow: "inset 0 0 0 1px var(--color-alpha-1)",
				}}
			>
				{percent > 0 && (
					<div
						data-usage-bar-fill
						className={`h-full w-full rounded-full ${FILL_CLASS[variant]} transition-transform duration-200 ease-[cubic-bezier(.165,.84,.44,1)] motion-reduce:transition-none rtl:[--_meter-dir:1]`}
						style={
						{
							transform: meterFillTransform(percent, size),
						}}
					/>
				)}
			</div>
		</div>
	);
}

/**
 * Upstream's 2026-10-20 popover row: label left, reset and percent right, over a 4px meter on a
 * variant-tinted track (inset alpha-1 ring) that names the row and describes it with the reset. The fill
 * takes upstream's `wV` severity: warning at 75%, danger at 90%.
 */
export function UsagePopoverLimitRow({
	label,
	usedPercentage,
	caption,
}: {
	label: string;
	usedPercentage: number;
	/** The reset ("Resets in 4 hr 11 min"), or upstream's `Kn` copy for a window that has not started. */
	caption: string;
})
{
	const labelId = useId();
	const resetId = useId();
	const percent = Math.round(Math.min(100, Math.max(0, usedPercentage)));
	const variant = usageVariant(percent);
	return (
		<div className="flex flex-col gap-1">
			<div data-usage-row className="flex flex-wrap items-baseline justify-between gap-x-2 text-[12px]/[15px]">
				<span id={labelId} className="text-primary">
					{label}
				</span>
				<span className="ms-auto flex items-baseline gap-1.5 tabular-nums text-muted-as-secondary">
					<span id={resetId}>{caption}</span>
					<span aria-hidden="true">{percent}%</span>
				</span>
			</div>
			<UsageMeter
				percent={percent}
				variant={variant}
				size="sm"
				labelledBy={labelId}
				describedBy={resetId}
				valueText={`${percent}% used`}
			/>
		</div>
	);
}
