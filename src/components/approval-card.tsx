import type {ButtonHTMLAttributes, ReactNode} from "react";

const ACTION_BUTTON =
	"inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-r5 px-2 text-[13px]/[19px] whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-50 [&_kbd]:text-[11px] @max-[500px]/approval-dock:w-full";

const ACTION_VARIANTS = {
	secondary: "border border-strong text-primary hover:bg-alpha-2",
	primary: "bg-primary font-medium text-surface-1 [--shortcut-cap-ink:currentColor] hover:bg-primary/80",
} as const;

export type ApprovalActionVariant = keyof typeof ACTION_VARIANTS;

/** Classes for an approval card action: an outline secondary or a black primary, 24px tall with 11px keycaps. */
function approvalActionClass(variant: ApprovalActionVariant): string {
	return `${ACTION_BUTTON} ${ACTION_VARIANTS[variant]}`;
}

export function ApprovalActionButton({
	variant,
	...props
}: {variant: ApprovalActionVariant} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type">) {
	return <button type="button" {...props} className={approvalActionClass(variant)} />;
}

export const APPROVAL_CARD_TITLE = "flex min-h-6 items-center text-[13px]/[19px] font-bold";

/**
 * The card docked above the composer for every pending approval, copied from
 * claude.ai/code: one shell (upstream shadow, 10px radius, 12px padding) with a
 * scrolling body and an action row that stacks full width below 500px.
 */
export function ApprovalCardShell({
	label,
	digits,
	body,
	actions,
}: {
	/** The card's accessible group label; omitted cards are a plain focusable box. */
	label?: string;
	/** Widest keycap digit count, which upstream uses to size the keycap column. */
	digits?: number;
	body: ReactNode;
	actions: ReactNode;
}) {
	return (
		<div className="@container/approval-dock [--approval-dock-floor:144px] @max-[500px]/approval-dock:[--approval-dock-floor:208px]">
			<div
				data-approval-card-root
				data-approval-card-digits={digits}
				role={label === undefined ? undefined : "group"}
				aria-label={label}
				tabIndex={0}
				className="relative isolate flex max-h-[60vh] flex-col gap-6 rounded-r7 bg-surface-popover p-3 text-[13px]/[19px] text-primary shadow-[var(--approval-card-shadow)]"
			>
				<div
					data-approval-card-body
					className="-mx-3 -mt-1 -mb-2 flex min-h-0 flex-col gap-2.5 overflow-y-auto px-3 pt-1 pb-2"
				>
					{body}
				</div>
				<div
					data-approval-card-actions
					className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 @max-[500px]/approval-dock:flex-col"
				>
					{actions}
				</div>
			</div>
		</div>
	);
}
