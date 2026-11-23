import type {CSSProperties, ReactNode} from "react";

/**
 * Upstream's cds Skeleton: a tinted block with a shimmer sweep and an sr-only
 * "Loading" status. Callers pass the shape (`h-[1em] rounded w-28`, `size-9 rounded-card`).
 */
export function Skeleton({
	className,
	style,
	decorative = false,
	silent = false,
	as: Tag = "div",
}: {
	className: string;
	style?: CSSProperties;
	/** Inside a decorative SkeletonGroup (upstream `XL`): a plain bar with no shimmer, role or label. */
	decorative?: boolean;
	/** Upstream's standalone `decorative`: the shimmer stays, but the bar is aria-hidden with no role or label. */
	silent?: boolean;
	/** Upstream's `as: "span"` renders a `block` span, for skeletons inside inline markup. */
	as?: "div" | "span";
})
{
	const block = Tag === "span" ? "block " : "";
	if (decorative)
		return (
			<Tag
				data-cds="Skeleton"
				style={style}
				className={`${block}max-w-full rounded bg-[var(--skeleton-base)] ${className}`}
			/>
		);
	// An overlay passes `absolute`; otherwise the shimmer is positioned against the block itself.
	const position = /(^|\s)absolute(\s|$)/.test(className) ? "" : "relative ";
	return (
		<Tag
			data-cds="Skeleton"
			role={silent ? undefined : "status"}
			aria-hidden={silent ? true : undefined}
			style={style}
			className={`${block}${position}max-w-full overflow-hidden bg-[var(--skeleton-base)] after:absolute after:inset-0 after:animate-[shimmer_2s_linear_infinite] after:bg-[linear-gradient(90deg,transparent,var(--skeleton-sheen),transparent)] motion-reduce:after:hidden ${className}`}
		>
			{silent ? null : <span className="sr-only">Loading</span>}
		</Tag>
	);
}

/**
 * Upstream's cds SkeletonGroup. The default is decorative (`$n`): no role or label, its children hidden from
 * assistive tech. `status` is upstream's labelled group: the group itself is the `role=status` region with an empty
 * sr-only `data-skeleton-label` span, and only its bars are hidden.
 * `hold="delayed"` fades the group in after `--placeholder-reveal-delay` (0.5s); `"none"` shows it at once.
 */
export function SkeletonGroup({
	hold,
	holdReason,
	status = false,
	children,
}: {
	hold: "delayed" | "none";
	holdReason?: string;
	status?: boolean;
	children: ReactNode;
})
{
	return (
		<div
			data-cds="SkeletonGroup"
			data-motion="wave"
			data-hold={hold}
			data-hold-reason={holdReason}
			role={status ? "status" : undefined}
			aria-hidden={status ? undefined : "true"}
		>
			{status ? <span className="sr-only" data-skeleton-label="true" /> : null}
			<div aria-hidden="true" className="contents">
				{children}
			</div>
		</div>
	);
}
