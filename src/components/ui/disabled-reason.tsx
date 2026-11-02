import {type ComponentProps, type ReactElement, useId, useLayoutEffect, useRef} from "react";

import {Tooltip} from "./tooltip";

const WRAPPER_CLASS =
	"inline-flex rounded-r5 outline-none hide-focus-ring transition-shadow duration-[60ms] focus-visible:shadow-focus";

/**
 * Upstream's cds disabled-reason wrapper: while `reason` is set, a focusable span around the disabled control,
 * described by a hidden copy of the reason and showing it in a tooltip. The wrapper stays mounted while there is
 * no reason (`tabIndex=-1`, no description), so the control never remounts when it flips between enabled and
 * disabled.
 *
 * When the control holding focus becomes disabled with a reason, focus is handed to the wrapper, which opens the
 * reason (upstream's roving focus heir plus `openOnHandedBackFocus`), instead of falling to `<body>`. When the
 * reason clears while the wrapper holds focus, focus goes back to the re-enabled control (upstream's focus-swap
 * hook).
 */
export function DisabledReason({
	reason,
	wrapperClassName,
	tabIndex = 0,
	side,
	children,
}: {
	reason: string | null | undefined;
	wrapperClassName?: string | undefined;
	/** The wrapper's tab index while it has a reason; a roving toolbar passes -1 for its hidden items. */
	tabIndex?: number;
	/** Where the reason tooltip opens (upstream Button/Switch `disabledReasonSide`); the Tooltip's default is top. */
	side?: ComponentProps<typeof Tooltip>["side"];
	children: ReactElement;
})
{
	const id = useId();
	const hasReason = reason !== null && reason !== undefined && reason !== "";
	const wrapperRef = useRef<HTMLSpanElement>(null);
	const hadReason = useRef(hasReason);
	// Focus was last inside the wrapper: set on focusin, kept when focus drops to nowhere (a control blurred by
	// becoming disabled), cleared only when focus moves to another element.
	const focusWasInside = useRef(false);

	useLayoutEffect(() =>
	{
		const wrapper = wrapperRef.current;
		const gained = hasReason && !hadReason.current;
		const lost = !hasReason && hadReason.current;
		hadReason.current = hasReason;
		if (wrapper === null) return;
		const active = document.activeElement;
		if (lost)
		{
			if (active !== wrapper) return;
			wrapper.querySelector<HTMLElement>("button, [role=switch], [tabindex]:not([tabindex='-1'])")?.focus(
				{
					preventScroll: true,
				},
			);
			return;
		}
		if (!gained) return;
		const focusDropped = (active === null || active === document.body) && focusWasInside.current;
		if (wrapper.contains(active) || focusDropped)
			wrapper.focus(
				{
					preventScroll: true,
				},
			);
	}, [hasReason]);

	return (
		<Tooltip
			content={reason ?? ""}
			variant="reason"
			{...(side === undefined
				? {}
				:
					{
						side,
					})}
			closeOnClick={false}
			openWhen={() => hasReason}
		>
			<span
				ref={wrapperRef}
				data-cds-disabled-reason-wrapper=""
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's wrapper is the tab stop that reaches a disabled control's reason
				tabIndex={hasReason ? tabIndex : -1}
				aria-describedby={hasReason ? id : undefined}
				onFocus={() =>
				{
					focusWasInside.current = true;
				}}
				onBlur={(event) =>
				{
					const next = event.relatedTarget;
					if (next !== null && !event.currentTarget.contains(next)) focusWasInside.current = false;
				}}
				className={wrapperClassName === undefined ? WRAPPER_CLASS : `${WRAPPER_CLASS} ${wrapperClassName}`}
			>
				{children}
				{hasReason && (
					<span id={id} hidden data-cds-disabled-reason="">
						{reason}
					</span>
				)}
			</span>
		</Tooltip>
	);
}
