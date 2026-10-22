import {type ReactElement, useId} from "react";

import {Tooltip} from "./tooltip";

const WRAPPER_CLASS =
	"inline-flex rounded-r5 outline-none hide-focus-ring transition-shadow duration-[60ms] focus-visible:shadow-focus";

/**
 * Upstream's cds disabled-reason wrapper: while `reason` is set, a focusable span around the disabled control,
 * described by a hidden copy of the reason and showing it in a tooltip. The wrapper stays mounted while there is
 * no reason (`tabIndex=-1`, no description), so the control never remounts when it flips between enabled and
 * disabled.
 */
export function DisabledReason({
	reason,
	wrapperClassName,
	children,
}: {
	reason: string | null | undefined;
	wrapperClassName?: string | undefined;
	children: ReactElement;
}) {
	const id = useId();
	const hasReason = reason !== null && reason !== undefined && reason !== "";

	return (
		<Tooltip content={reason ?? ""} variant="reason" closeOnClick={false} openWhen={() => hasReason}>
			<span
				data-cds-disabled-reason-wrapper=""
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's wrapper is the tab stop that reaches a disabled control's reason
				tabIndex={hasReason ? 0 : -1}
				aria-describedby={hasReason ? id : undefined}
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
