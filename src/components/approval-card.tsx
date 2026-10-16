import type {ButtonHTMLAttributes, ReactNode} from "react";

const ACTION_BUTTON =
	"inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-r5 px-2 text-[13px]/[19px] whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-50 [&_kbd]:text-[11px]";

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

export const APPROVAL_CARD_TITLE = "flex min-h-6 items-center text-[13px]/[19px] font-[580]";

/** Upstream's `@container (width <= 420px)` stack: the action row and its button group, full width. */
const STACK_ACTIONS =
	"@max-[420px]:flex-col @max-[420px]:items-stretch @max-[420px]:[&>span]:ms-0 @max-[420px]:[&>span]:flex-col @max-[420px]:[&>span]:items-stretch";

/**
 * Upstream's approval card shell for a pending permission: a scrolling body
 * and an action row, 10px radius and 12px padding. Each card is its own
 * inline-size container, and at upstream's 420px its actions stack full width.
 * Inline in the transcript ("card") it is outlined and transparent; docked above
 * the composer it takes the popover fill and shadow.
 */
export function ApprovalCardShell({
	label,
	digits,
	body,
	actions,
	footer,
	presentation = "dock",
}: {
	/** The card's accessible group label; omitted cards are a plain focusable box. */
	label?: string;
	/** Widest keycap digit count, which upstream uses to size the keycap column. */
	digits?: number;
	body: ReactNode;
	actions: ReactNode;
	/** A line under the actions, such as the tool-approval notify tip. */
	footer?: ReactNode;
	/** Upstream's inline "card" in the transcript, or the composer "dock". */
	presentation?: "card" | "dock";
}) {
	const look = presentation === "card" ? "card-ring" : "bg-surface-popover shadow-[var(--approval-card-shadow)]";
	return (
		<div className="@container/approval-dock [--approval-dock-floor:144px] @max-[500px]/approval-dock:[--approval-dock-floor:208px]">
			<div
				data-approval-card-root
				data-approval-card-digits={digits}
				data-approval-presentation={presentation}
				role={label === undefined ? undefined : "group"}
				aria-label={label}
				tabIndex={0}
				className={`@container relative isolate flex max-h-[60vh] flex-col gap-3 rounded-r7 p-3 text-[13px]/[19px] text-primary ${look}`}
			>
				<div
					data-approval-card-body
					className="-mx-3 -mt-1 -mb-2 flex min-h-0 flex-col gap-2.5 overflow-y-auto px-3 pt-1 pb-2"
				>
					{body}
				</div>
				<div
					data-approval-card-actions
					className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-2 ${STACK_ACTIONS}`}
				>
					{actions}
				</div>
				{footer}
			</div>
		</div>
	);
}

const TERMINAL_FOOTNOTE = "Answer in the terminal running this session.";

/**
 * Stands where upstream docks the pending question card, directly above the composer,
 * when no hook reported the question: the awaiting dot and a plain line, with
 * no options to pick, since the question itself is not on disk yet.
 */
export function WaitingForInputNotice() {
	return (
		<div
			role="status"
			aria-label="Waiting for your input"
			data-waiting-input-notice
			className="flex items-start gap-2 rounded-r7 bg-surface-popover p-3 text-[13px]/[19px] text-primary shadow-[var(--approval-card-shadow)]"
		>
			<span aria-hidden="true" className="flex h-[19px] shrink-0 items-center">
				<span className="status-dot" data-kind="awaiting" />
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="font-[580]">Waiting for your input</span>
				<span className="text-footnote text-secondary">{TERMINAL_FOOTNOTE}</span>
			</span>
		</div>
	);
}
