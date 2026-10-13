import type {ButtonHTMLAttributes, ReactNode} from "react";
import type {PendingQuestionItem} from "../lib/hook-events";

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

/**
 * Upstream's docked question card, read-only: every question the session's
 * `PreToolUse` hook reported, with its i/n pill, header and options, which
 * stay disabled because only the terminal can answer.
 */
export function PendingQuestionCard({questions}: {questions: PendingQuestionItem[]}) {
	return (
		<ApprovalCardShell
			label="Waiting for your input"
			body={questions.map((question, questionIndex) => (
				<div key={question.question} data-pending-question className="flex flex-col gap-2.5">
					<div className="flex items-start gap-2">
						<span className="flex h-6 shrink-0 items-center">
							<span
								data-approval-pill
								className="rounded-full bg-warning-100/10 px-1.5 text-caption text-warning-000"
							>
								{questionIndex + 1}/{questions.length}
							</span>
						</span>
						<div className="flex min-w-0 flex-1 flex-col">
							{question.header !== undefined && (
								<span data-pending-question-header className="text-caption text-secondary">
									{question.header}
								</span>
							)}
							<span data-approval-card-title className={APPROVAL_CARD_TITLE}>
								{question.question}
							</span>
						</div>
					</div>
					{question.options.map((option) => (
						<button
							key={option.label}
							type="button"
							disabled
							className="flex w-full cursor-not-allowed items-center gap-2 rounded-r4 bg-alpha-1 px-3 py-3 text-left"
						>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="text-body text-primary">{option.label}</span>
								{option.description !== undefined && (
									<span className="text-footnote text-secondary">{option.description}</span>
								)}
							</span>
						</button>
					))}
					{question.multiSelect === true && (
						<p data-pending-question-multiselect className="text-footnote text-secondary">
							Select one or more options.
						</p>
					)}
				</div>
			))}
			actions={
				<span className="flex items-center gap-2 text-footnote text-secondary">
					<span aria-hidden="true" className="status-dot" data-kind="awaiting" />
					{TERMINAL_FOOTNOTE}
				</span>
			}
		/>
	);
}
