import type {CSSProperties, HTMLAttributes, ReactElement, ReactNode} from "react";

type DataAttributes =
{
	[key: `data-${string}`]: string | undefined;
};

const PULSE_SOLID_TEXT_CLASS =
	"[--cds-text-primary:var(--cds-solid-primary)] [--cds-text-secondary:var(--cds-solid-secondary)] [--cds-text-muted:var(--cds-solid-muted)]";

/**
 * Upstream cds Pulse (`ba`): a 6px status dot painted inline in `color`, ringed 0.5px in
 * `--cds-ground`, falling back to `--cds-page-bg`, to lift it off what is under it (wrappers set
 * the page bg to transparent). `animate` pulses it under motion-safe:; `hollow` draws an inset 1px
 * ring instead of a fill. Like upstream, every dot unconditionally remaps the text inks to the
 * `--cds-solid-*` inks, so a `color` that reads one of them (the running dot's `--cds-text-muted`)
 * takes the solid ink.
 */
export function Pulse({
	color = "var(--cds-fill-accent)",
	animate = true,
	hollow = false,
	className,
	...rest
}:
{
	color?: string;
	animate?: boolean;
	hollow?: boolean;
	className?: string;
} & DataAttributes &
	Pick<HTMLAttributes<HTMLSpanElement>, "aria-hidden">)
{
	const classes = [
		"block size-[calc(0.375rem*var(--cds-rem-scale,1))] rounded-full",
		PULSE_SOLID_TEXT_CLASS,
		animate ? "motion-safe:animate-pulse" : null,
		hollow
			? "forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText]"
			: "forced-colors:!bg-[color:CanvasText]",
		className,
	];
	const style: CSSProperties = hollow
		?
			{
				boxShadow: `inset 0 0 0 1px ${color}, 0 0 0 0.5px var(--cds-ground, var(--cds-page-bg))`,
			}
		:
			{
				background: color,
				boxShadow: "0 0 0 0.5px var(--cds-ground, var(--cds-page-bg))",
			};
	return <span {...rest} data-cds="Pulse" className={classes.filter(Boolean).join(" ")} style={style} />;
}

const SLOT_ICON_CLASS =
	"col-start-1 row-start-1 [--btn-dot-r:calc(0.1875rem*var(--cds-rem-scale,1))] [--btn-dot-x:calc(100%_-_var(--btn-dot-r)_+_1px)] [&:dir(rtl)]:[--btn-dot-x:calc(var(--btn-dot-r)_-_1px)] not-forced-colors:has-[~[data-cds-part=indicator]>[data-cds=Pulse]]:[mask-image:radial-gradient(circle_at_var(--btn-dot-x)_calc(var(--btn-dot-r)_-_1px),transparent_calc(var(--btn-dot-r)_+_1px),black_calc(var(--btn-dot-r)_+_1.5px))]";

const SLOT_INDICATOR_CLASS =
	"relative col-start-1 row-start-1 -me-px -mt-px self-start justify-self-end has-[>[data-cds=Pulse]]:[--cds-page-bg:transparent]";

/**
 * Upstream cds Button's indicator slot (`yb`): the icon and an aria-hidden indicator share one grid
 * cell, the indicator at the top-end corner; a Pulse indicator notches the icon with a radial mask
 * (mirrored in RTL, dropped in forced colors). Labelled buttons pass `-ms-1` / `-me-1`. Carry the
 * indicator's meaning in the button's name or aria-describedby.
 */
export function IndicatorSlot({
	icon,
	indicator,
	className,
}: {
	icon: ReactNode;
	indicator: ReactNode;
	className?: string;
}): ReactElement
{
	if (indicator === undefined || indicator === null || indicator === false) return <>{icon}</>;
	return (
		<span className={className === undefined ? "grid" : `grid ${className}`}>
			<span className={SLOT_ICON_CLASS}>{icon}</span>
			<span aria-hidden="true" data-cds-part="indicator" className={SLOT_INDICATOR_CLASS}>
				{indicator}
			</span>
		</span>
	);
}
