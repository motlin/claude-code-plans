import type {CSSProperties, ReactNode, Ref} from "react";

/**
 * Upstream's ShimmerText: the text in secondary ink, plus an aria-hidden, inert clone
 * masked to the glyphs whose `:after` band sweeps a 30%-white peak across them
 * (`[data-cds=ShimmerText]` rules in globals.css). `active={false}` keeps the span
 * mounted with no clone, `variant="muted"` inherits the surrounding ink, and `delay`
 * (ms, usually `shimmerPhaseDelay()`) offsets the band.
 */
export function ShimmerText({
	children,
	className,
	id,
	active = true,
	variant = "secondary",
	delay,
	ref,
}: {
	children: ReactNode;
	className?: string;
	id?: string;
	active?: boolean;
	variant?: "secondary" | "muted";
	delay?: number;
	/** The row-cut observer's ref, for a label that fades when it overflows. */
	ref?: Ref<HTMLSpanElement> | undefined;
}) {
	const style = delay === undefined ? undefined : ({"--shimmer-delay": `${delay}ms`} as CSSProperties);
	const classes = active ? (className === undefined ? "relative" : `relative ${className}`) : className;
	return (
		<span
			ref={ref}
			id={id}
			data-cds="ShimmerText"
			data-shimmering={active ? "true" : "false"}
			dir="auto"
			data-variant={variant === "muted" ? "muted" : undefined}
			className={classes}
			style={style}
		>
			{children}
			{active && (
				<span data-cds-shimmer-clone="" aria-hidden="true" inert>
					{children}
				</span>
			)}
		</span>
	);
}
