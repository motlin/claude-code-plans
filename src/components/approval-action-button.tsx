import type {ButtonHTMLAttributes, Ref} from "react";

import {type CdsButtonSize, type CdsButtonVariant, cdsButtonClass} from "./ui/cds-button";
import {Spinner} from "./ui/spinner";

/**
 * Upstream's cds Button shortcut: `ms-1` after the label, and as the button's last child an end margin
 * that centres the last keycap in the button's end padding (-4px at 28px with a 9px pad).
 */
export const APPROVAL_ACTION_SHORTCUT_CLASS =
	"pointer-coarse:hidden ms-1 me-[calc((var(--cds-h-control)-1em-6px)/2-min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md))))]";

export type ApprovalActionVariant = CdsButtonVariant;
export type ApprovalActionSize = CdsButtonSize;

/**
 * An approval card action. `busy` is upstream's busy cds Button: it stays focusable
 * (`aria-busy` + `aria-disabled`, not `disabled`), ignores clicks, hides its label and
 * centres a 12px spinner over it. `busyLabel` (upstream's "Sending…") names it while busy. Like upstream's cds
 * Button, it swallows a held (repeat) Enter or Space.
 */
export function ApprovalActionButton({
	variant,
	size = "default",
	busy = false,
	busyLabel,
	children,
	onClick,
	onKeyDown,
	...props
}:
{
	variant: ApprovalActionVariant;
	size?: ApprovalActionSize;
	busy?: boolean;
	busyLabel?: string;
	/** A Tooltip `triggerIsChild` anchors on the button itself. */
	ref?: Ref<HTMLButtonElement>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type" | "aria-busy" | "aria-disabled">)
{
	return (
		<button
			type="button"
			{...props}
			onClick={busy ? undefined : onClick}
			onKeyDown={(event) =>
			{
				// Upstream's cds Button: a held Enter or Space never re-activates a focused button.
				if (event.repeat && (event.key === "Enter" || event.key === " "))
				{
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				onKeyDown?.(event);
			}}
			data-approval-variant={variant}
			{...(size === "sm"
				?
					{
						"data-size": "sm",
					}
				: {})}
			{...(busy
				?
					{
						"aria-busy": true,
						"aria-disabled": true,
					}
				: {})}
			{...(busy && busyLabel !== undefined
				?
					{
						"aria-label": busyLabel,
					}
				: {})}
			className={cdsButtonClass(variant, size)}
		>
			{busy ? (
				<>
					<span className="inline-flex min-w-0 items-center gap-1 opacity-0">{children}</span>
					<span aria-hidden="true" className="absolute inset-0 grid place-items-center leading-[0]">
						<Spinner size="sm" tone="current" />
					</span>
				</>
			) : (
				children
			)}
		</button>
	);
}
