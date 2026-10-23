import {Loader2} from "lucide-react";
import type {ButtonHTMLAttributes, KeyboardEvent, ReactNode, Ref} from "react";

const ACTION_BUTTON =
	"inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-r5 px-2 text-[13px]/[19px] whitespace-nowrap select-none hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 [&_kbd]:text-[11px]";

const ACTION_VARIANTS = {
	secondary: "bg-fill-secondary shadow-field-drop text-primary hover:bg-fill-secondary-hover",
	primary: "bg-primary font-medium text-surface-1 [--shortcut-cap-ink:currentColor] hover:bg-primary/80",
} as const;

export type ApprovalActionVariant = keyof typeof ACTION_VARIANTS;

/** Classes for an approval card action: upstream's filled secondary or a black primary, 24px tall with 11px keycaps. */
function approvalActionClass(variant: ApprovalActionVariant): string {
	return `${ACTION_BUTTON} ${ACTION_VARIANTS[variant]}`;
}

/** An approval card action; `busy` marks it aria-busy and leads it with upstream's spinner. */
export function ApprovalActionButton({
	variant,
	busy = false,
	children,
	...props
}: {variant: ApprovalActionVariant; busy?: boolean} & Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"className" | "type" | "aria-busy"
>) {
	return (
		<button
			type="button"
			{...props}
			data-approval-variant={variant}
			aria-busy={busy || undefined}
			className={approvalActionClass(variant)}
		>
			{busy && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
			{children}
		</button>
	);
}

export const APPROVAL_CARD_TITLE = "flex min-h-6 items-center text-[13px]/[19px] font-[580]";

/**
 * Upstream's `@container (width <= 420px)` stack: the action row and its allow
 * group (`[data-approval-allow]`), full width. A split button stretches too, its primary segment taking
 * the spare width (`width:100%` and `flex:auto`).
 */
const STACK_ACTIONS =
	"@max-[420px]:flex-col @max-[420px]:items-stretch @max-[420px]:[&>div]:flex-col @max-[420px]:[&>div]:items-stretch @max-[420px]:[&_[data-cds=SplitDropdownButton]]:w-full @max-[420px]:[&_[data-cds=SplitDropdownButton]>[data-cds-segment]:first-child_button]:flex-auto";

const ROAM_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

function enabledButtons(actions: HTMLElement | null): HTMLButtonElement[] {
	return actions === null ? [] : [...actions.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
}

function isPrimary(button: HTMLButtonElement): boolean {
	return button.matches("[data-approval-primary]") || button.querySelector("[data-approval-primary]") !== null;
}

/**
 * Upstream's card root keys (`Sq`): from the root or an action, the arrows roam the enabled
 * action buttons, wrapping and mirrored in RTL. Enter on the root itself focuses the primary
 * (else the last button), and a repeated Enter on an action is swallowed.
 */
function onApprovalRootKeyDown(event: KeyboardEvent<HTMLDivElement>) {
	const root = event.currentTarget;
	const actions = root.querySelector<HTMLElement>("[data-approval-card-actions]");
	const target = event.target instanceof Element ? event.target : null;
	const fromActions = target !== null && actions?.contains(target) === true;
	if (ROAM_KEYS.has(event.key)) {
		if (target !== root && !fromActions) return;
		const buttons = enabledButtons(actions);
		if (buttons.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		const rtl = getComputedStyle(root).direction === "rtl";
		const back = event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft");
		const step = back ? -1 : 1;
		const at = buttons.findIndex((button) => button === root.ownerDocument.activeElement);
		const next = at === -1 ? (step === 1 ? 0 : buttons.length - 1) : (at + step + buttons.length) % buttons.length;
		buttons[next]?.focus();
		return;
	}
	if (event.key !== "Enter") return;
	if (event.repeat && fromActions) {
		event.preventDefault();
		event.stopPropagation();
		return;
	}
	if (target !== root || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
	const buttons = enabledButtons(actions);
	const primary = buttons.find(isPrimary) ?? buttons.at(-1);
	if (primary === undefined) return;
	event.preventDefault();
	event.stopPropagation();
	primary.focus();
}

/**
 * Upstream's approval card shell for a pending permission: a scrolling body
 * and an action row, 10px radius and 12px padding. Each card is its own
 * inline-size container, and at upstream's 420px its actions stack full width.
 * Inline in the transcript ("card") it is outlined and transparent; docked above
 * the composer it takes the popover fill and shadow.
 */
export function ApprovalCardShell({
	rootRef,
	label,
	digits,
	body,
	actions,
	footer,
	presentation = "dock",
	enter = false,
}: {
	rootRef?: Ref<HTMLDivElement>;
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
	/** Upstream's 160ms enter fade for a live arrival; false marks the card `data-skip-approval-enter`. */
	enter?: boolean;
}) {
	// Inline, upstream's card is at most 480px wide with 24px gaps; the dock keeps its 12px rhythm.
	const look =
		presentation === "card"
			? "card-ring w-full max-w-[480px] gap-[24px]"
			: "bg-surface-popover shadow-[var(--approval-card-shadow)] gap-3";
	const bodyGap = presentation === "card" ? "gap-[24px]" : "gap-2.5";
	return (
		<div className="@container/approval-dock [--approval-dock-floor:144px] @max-[500px]/approval-dock:[--approval-dock-floor:208px]">
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions -- upstream's focusable card root: arrows roam its action buttons, Enter focuses the primary, and clicks stop short of the transcript */}
			<div
				ref={rootRef}
				data-approval-card-root
				data-approval-card-digits={digits}
				data-approval-presentation={presentation}
				{...(enter ? {} : {"data-skip-approval-enter": ""})}
				role={label === undefined ? undefined : "group"}
				aria-label={label}
				tabIndex={0}
				onKeyDown={onApprovalRootKeyDown}
				onClick={(event) => {
					event.stopPropagation();
				}}
				className={`@container relative isolate flex max-h-[60vh] flex-col rounded-r7 p-3 text-[13px]/[19px] text-primary focus-visible:outline-1 focus-visible:outline-fill-accent focus-visible:outline-offset-2 ${look}${enter ? " animate-approval-inline-enter motion-reduce:animate-none" : ""}`}
			>
				<div
					data-approval-card-body
					className={`-mx-3 -mt-1 -mb-2 flex min-h-0 flex-col overflow-y-auto px-3 pt-1 pb-2 ${bodyGap}`}
				>
					{body}
				</div>
				<div
					data-approval-card-actions
					className={`flex flex-wrap items-start justify-end gap-x-3 gap-y-2 ${STACK_ACTIONS}`}
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
