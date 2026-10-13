import {ChevronRight, X} from "lucide-react";
import type {ButtonHTMLAttributes, ReactNode} from "react";
import type {PendingQuestionItem} from "../lib/hook-events";
import {Shortcut} from "./ui/shortcut";

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

export const APPROVAL_CARD_TITLE = "flex min-h-6 items-center text-[13px]/[19px] font-[580]";

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
				className="relative isolate flex max-h-[60vh] flex-col gap-3 rounded-r7 bg-surface-popover p-3 text-[13px]/[19px] text-primary shadow-[var(--approval-card-shadow)]"
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

const PENDING_ICON_BUTTON =
	"inline-flex size-6 shrink-0 items-center justify-center rounded-r4 text-secondary disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Upstream's docked question card, read-only: every question the session's
 * `PreToolUse` hook reported, drawn as upstream draws it (an i/n pill only for
 * several questions, keycapped options, an Other row, Skip and Submit), with
 * every control disabled because only the terminal can answer.
 */
export function PendingQuestionCard({questions}: {questions: PendingQuestionItem[]}) {
	return (
		<ApprovalCardShell
			label="Waiting for your input"
			body={
				<>
					{questions.map((question, questionIndex) => (
						<div key={question.question} data-pending-question className="flex flex-col gap-2.5">
							<div className="flex items-start gap-2">
								{questions.length > 1 && (
									<span className="flex h-6 shrink-0 items-center">
										<span
											data-approval-pill
											className="rounded-full bg-warning-100/10 px-1.5 text-caption text-warning-000"
										>
											{questionIndex + 1}/{questions.length}
										</span>
									</span>
								)}
								<span data-approval-card-title className={`min-w-0 flex-1 ${APPROVAL_CARD_TITLE}`}>
									{question.question}
								</span>
								<button
									type="button"
									disabled
									data-pending-question-icon
									aria-label="View question options"
									className={PENDING_ICON_BUTTON}
								>
									<ChevronRight aria-hidden="true" className="size-4 rotate-90" />
								</button>
								<button
									type="button"
									disabled
									data-pending-question-icon
									aria-label="Dismiss question"
									className={PENDING_ICON_BUTTON}
								>
									<X aria-hidden="true" className="size-4" />
								</button>
							</div>
							<div className="flex flex-col gap-[3px]">
								{question.options.map((option, optionIndex) => (
									<button
										key={option.label}
										type="button"
										disabled
										data-pending-question-option
										className="flex w-full cursor-not-allowed items-center gap-2 rounded-r4 p-2 bg-alpha-1 text-left"
									>
										<span className="flex min-w-0 flex-1 flex-col">
											<span data-option-label className="text-body text-primary">
												{option.label}
											</span>
											{option.description !== undefined && (
												<span
													data-option-description
													className="text-[12px]/[15px] text-ink-muted whitespace-pre-wrap"
												>
													{option.description}
												</span>
											)}
										</span>
										<Shortcut keys={String(optionIndex + 1)} className="pointer-coarse:hidden" />
									</button>
								))}
								<div
									data-pending-question-other
									className="flex w-full items-center gap-3 rounded-r4 p-2 bg-alpha-1"
								>
									<textarea
										disabled
										aria-label="Other option"
										placeholder="Type your own answer here"
										rows={1}
										className="min-w-0 flex-1 resize-none cursor-not-allowed rounded-r5 bg-white/50 px-2 py-1.5 text-body text-primary outline-none ring-1 ring-border placeholder:text-secondary"
									/>
									<Shortcut
										keys={String(question.options.length + 1)}
										className="pointer-coarse:hidden"
									/>
								</div>
							</div>
							{question.multiSelect === true && (
								<p data-pending-question-multiselect className="text-footnote text-secondary">
									Select one or more options.
								</p>
							)}
						</div>
					))}
					<span
						data-pending-question-footnote
						className="flex items-center gap-2 text-footnote text-secondary"
					>
						<span aria-hidden="true" className="status-dot" data-kind="awaiting" />
						{TERMINAL_FOOTNOTE}
					</span>
				</>
			}
			actions={
				<span className="ms-auto flex items-center gap-2">
					<ApprovalActionButton variant="secondary" disabled>
						Skip
					</ApprovalActionButton>
					<ApprovalActionButton variant="primary" disabled>
						Submit
						<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
					</ApprovalActionButton>
				</span>
			}
		/>
	);
}
