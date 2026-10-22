import type {ReactNode} from "react";

/**
 * Upstream's ShimmerText: the text in secondary ink, plus an aria-hidden, inert clone
 * masked to the glyphs whose `:after` band sweeps a 30%-white peak across them
 * (`[data-cds=ShimmerText]` rules in globals.css).
 */
export function ShimmerText({children, className}: {children: ReactNode; className?: string}) {
	return (
		<span
			data-cds="ShimmerText"
			data-shimmering="true"
			dir="auto"
			className={className === undefined ? "relative" : `relative ${className}`}
		>
			{children}
			<span data-cds-shimmer-clone="" aria-hidden="true" inert>
				{children}
			</span>
		</span>
	);
}
