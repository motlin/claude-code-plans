import type {CSSProperties} from "react";

/**
 * Upstream's cds Skeleton: a tinted block with a shimmer sweep and an sr-only
 * "Loading" status. Callers pass the shape (`h-[1em] rounded w-28`, `size-9 rounded-card`).
 */
export function Skeleton({className, style}: {className: string; style?: CSSProperties}) {
	// An overlay passes `absolute`; otherwise the shimmer is positioned against the block itself.
	const position = /(^|\s)absolute(\s|$)/.test(className) ? "" : "relative ";
	return (
		<div
			data-cds="Skeleton"
			role="status"
			style={style}
			className={`${position}max-w-full overflow-hidden bg-[var(--skeleton-base)] after:absolute after:inset-0 after:animate-[shimmer_2s_linear_infinite] after:bg-[linear-gradient(90deg,transparent,var(--skeleton-sheen),transparent)] motion-reduce:after:hidden ${className}`}
		>
			<span className="sr-only">Loading</span>
		</div>
	);
}
