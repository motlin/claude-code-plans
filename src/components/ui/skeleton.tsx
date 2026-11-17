import type {CSSProperties, ReactNode} from "react";

/**
 * Upstream's cds Skeleton: a tinted block with a shimmer sweep and an sr-only
 * "Loading" status. Callers pass the shape (`h-[1em] rounded w-28`, `size-9 rounded-card`).
 */
export function Skeleton({
	className,
	style,
	decorative = false,
}: {
	className: string;
	style?: CSSProperties;
	/** Inside a decorative SkeletonGroup (upstream `XL`): a plain bar with no shimmer, role or label. */
	decorative?: boolean;
})
{
	if (decorative)
		return (
			<div
				data-cds="Skeleton"
				style={style}
				className={`max-w-full rounded bg-[var(--skeleton-base)] ${className}`}
			/>
		);
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

/**
 * Upstream's decorative cds SkeletonGroup (`$n`): no role or label, its children hidden from assistive tech.
 * `hold="delayed"` fades the group in after `--placeholder-reveal-delay` (0.5s); `"none"` shows it at once.
 */
export function SkeletonGroup({
	hold,
	holdReason,
	children,
}: {
	hold: "delayed" | "none";
	holdReason?: string;
	children: ReactNode;
})
{
	return (
		<div
			data-cds="SkeletonGroup"
			data-motion="wave"
			data-hold={hold}
			data-hold-reason={holdReason}
			aria-hidden="true"
		>
			<div aria-hidden="true" className="contents">
				{children}
			</div>
		</div>
	);
}
