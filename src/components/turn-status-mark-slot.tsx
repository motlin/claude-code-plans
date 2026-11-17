import {useEffect, useEffectEvent, useRef, type ReactNode} from "react";
import {isMotionReduced} from "../lib/reduced-motion";

/** Upstream `gW`: the mark slot's leave easing. */
const MARK_LEAVE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Upstream `kI`: mark plus gap is always 20 + 12px, so the margin takes up what gap-xs leaves. */
const MARK_SLOT_CLASS =
	"relative flex h-[1lh] shrink-0 items-center justify-center w-[20px] me-[calc(12px_-_var(--cds-gap-xs))]";

const MARK_CENTER_CLASS =
	"absolute top-1/2 left-1/2 flex size-icon -translate-x-1/2 -translate-y-1/2 items-center justify-center motion-reduce:transition-none opacity-100";

/** Upstream `zG`'s motion: `leaving` collapses the slot, then `onLeft` unmounts it. */
export type MarkSlotMotion = "busy" | "leaving";

/**
 * Upstream shared-frame `zG`: a TurnStatus row's leading 20px mark slot. When the row stops being
 * marked the slot collapses its width and end margin (through the row gap) while the mark scales out,
 * over 400ms, so the label glides back to the row start; under reduced motion it leaves at once.
 */
export function TurnStatusMarkSlot({
	motion,
	onLeft,
	children,
}: Readonly<
{
	motion: MarkSlotMotion;
	onLeft?: () => void;
	children: ReactNode;
}>)
{
	const ref = useRef<HTMLSpanElement>(null);
	const left = useEffectEvent(() => onLeft?.());
	const leaving = motion === "leaving";
	useEffect(() =>
	{
		const el = ref.current;
		if (!leaving || el === null || typeof el.animate !== "function" || isMotionReduced(el.ownerDocument))
		{
			if (leaving) left();
			return undefined;
		}
		const view = el.ownerDocument.defaultView ?? window;
		const gap = el.parentElement ? view.getComputedStyle(el.parentElement).columnGap : "0px";
		const collapsedEnd = `calc(-1 * ${gap === "normal" ? "0px" : gap})`;
		const end = view.getComputedStyle(el).marginInlineEnd;
		const width = el.getBoundingClientRect().width;
		let animation: Animation | undefined;
		let cancelled = false;
		queueMicrotask(() =>
		{
			if (cancelled) return;
			animation = el.animate(
				[
					{
						offset: 0,
						width: `${width}px`,
						marginInlineEnd: end,
						opacity: 1,
						transform: "scale(1)",
					},
					{
						offset: 0.6,
						opacity: 1,
					},
					{
						offset: 1,
						width: "0px",
						marginInlineEnd: collapsedEnd,
						opacity: 0,
						transform: "scale(0)",
					},
				],
				{
					duration: 400,
					easing: MARK_LEAVE_EASING,
					fill: "forwards",
				},
			);
			animation.finished.then(
				() => left(),
				() => {},
			);
		});
		return () =>
		{
			cancelled = true;
			animation?.cancel();
		};
	}, [leaving]);
	return (
		<span ref={ref} aria-hidden="true" data-cds-row-mark="" className={MARK_SLOT_CLASS}>
			<span className={MARK_CENTER_CLASS}>{children}</span>
		</span>
	);
}
