import {type ReactNode, useState} from "react";

import {RAIL_CARD_RING_CLASS} from "./rail-row";

type SkeletonHold = "delayed" | "none";

/** One cds Skeleton bar inside a wave group; `index` staggers its breathe 90ms per step. */
function Bar({className, index, height}: {className: string; index: number; height?: number})
{
	return (
		<div
			data-skeleton=""
			data-cds="Skeleton"
			className={`${className} max-w-full rounded bg-[var(--skeleton-base)]`}
			style={
			{
				...(height === undefined
					? {}
					:
						{
							height: `${height}px`,
						}),
				["--skel-i" as string]: index,
			}}
		/>
	);
}

/**
 * Upstream's rail card SkeletonGroup (`flex flex-col gap-sm py-md px-lg`) at default density:
 * pad-md 8px, pad-lg 12px, gap-sm 8px (comfortable is 12/16/12). The first card's group is the
 * one `role=status` "Loading session details"; the second is decorative.
 */
function CardGroup({
	hold,
	holdReason,
	label,
	children,
}: {
	hold: SkeletonHold;
	holdReason: string | undefined;
	label?: string;
	children: ReactNode;
})
{
	// Upstream marks an unheld group shown at once; a delayed one gets data-shown and its label when the fade-in ends.
	const [shown, setShown] = useState(hold === "none");
	return (
		<div
			data-skeleton-group=""
			data-cds="SkeletonGroup"
			data-motion="wave"
			data-hold={hold}
			data-hold-reason={holdReason}
			data-shown={shown ? "" : undefined}
			onAnimationEnd={(event) =>
			{
				if (event.animationName === "placeholder-reveal" && event.target === event.currentTarget)
					setShown(true);
			}}
			{...(label === undefined
				?
					{
						"aria-hidden": "true" as const,
					}
				:
					{
						role: "status",
					})}
			className="flex flex-col gap-2 py-2 px-3"
		>
			{label !== undefined && (
				<span className="sr-only" data-skeleton-label="true">
					{shown ? label : ""}
				</span>
			)}
			<div aria-hidden="true" className="contents">
				{children}
			</div>
		</div>
	);
}

/**
 * Upstream's session rail skeleton (shared-20 `fn`): two cards shown while the rail's cards chunk
 * loads. The first card takes the remembered `--session-rail-first-card-h` (default 8+28+4·32+6 =
 * 170px, comfortable 176) and hides its two rows through `--session-rail-first-card-rows` when that
 * height is too short for them; the second is 2·8+24 = 40px (comfortable 48) under a hairline.
 */
export function SessionRailSkeleton({hold = "none", holdReason}: {hold?: SkeletonHold; holdReason?: string})
{
	return (
		<div className="flex w-[var(--session-rail-w,17.5rem)] flex-col gap-2.5 p-px [[data-session-rail-flat]_&]:gap-0 [[data-session-rail-flat]_&]:p-0">
			<div className={`h-[var(--session-rail-first-card-h,170px)] overflow-hidden ${RAIL_CARD_RING_CLASS}`}>
				<CardGroup hold={hold} holdReason={holdReason} label="Loading session details">
					<Bar className="h-[1em] w-20" index={0} height={14} />
					<div className="[display:var(--session-rail-first-card-rows,contents)]">
						<Bar className="h-5 w-full" index={1} />
						<Bar className="h-5 w-full" index={2} />
					</div>
				</CardGroup>
			</div>
			<div
				className={`relative h-10 overflow-hidden ${RAIL_CARD_RING_CLASS} before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-alpha-1`}
			>
				<CardGroup hold={hold} holdReason={holdReason}>
					<Bar className="h-[1em] w-20" index={0} height={14} />
				</CardGroup>
			</div>
		</div>
	);
}
