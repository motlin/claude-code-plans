import {Check, ChevronRight, Loader2, X} from "lucide-react";
import {useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode} from "react";
import {dockKeyAllowed} from "../lib/dock-keys";
import type {PendingQuestionItem, QuestionAnswer} from "../lib/hook-events";
import {
	chooseOther,
	draftAnswer,
	EMPTY_QUESTION_DRAFT,
	pickOption,
	typeOther,
	type QuestionCardDraft,
} from "../lib/question-card-draft";
import {Shortcut} from "./ui/shortcut";

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

/**
 * The card docked above the composer for every pending approval, copied from
 * claude.ai/code: one shell (upstream shadow, 10px radius, 12px padding) with a
 * scrolling body and an action row. Below 500px a permission card stacks its
 * actions full width, while a question card keeps them compact at the right.
 */
export function ApprovalCardShell({
	label,
	digits,
	body,
	actions,
	stackActions = true,
	footer,
}: {
	/** The card's accessible group label; omitted cards are a plain focusable box. */
	label?: string;
	/** Widest keycap digit count, which upstream uses to size the keycap column. */
	digits?: number;
	body: ReactNode;
	actions: ReactNode;
	/** Whether the actions stack full width below 500px; question cards keep upstream's compact row. */
	stackActions?: boolean;
	/** A line under the actions, such as the tool-approval notify tip. */
	footer?: ReactNode;
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
					className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-2 ${stackActions ? "@max-[500px]/approval-dock:flex-col @max-[500px]/approval-dock:*:w-full" : "@max-[500px]/approval-dock:justify-end"}`}
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

const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)/;

/** The text with each http(s) URL drawn as an underlined link that opens in a new tab. */
function LinkifiedText({text}: {text: string}) {
	return text.split(URL_PATTERN).map((part, index) =>
		index % 2 === 1 ? (
			<a
				key={index}
				href={part}
				target="_blank"
				rel="noopener noreferrer"
				className="underline underline-offset-[3px]"
			>
				{part}
			</a>
		) : (
			part
		),
	);
}

/** An option's right-hand mark: its number keycap, or upstream's 14px checkbox for a multi-select question. */
function ChoiceMark({multiSelect, keys, checked = false}: {multiSelect: boolean; keys: string; checked?: boolean}) {
	if (!multiSelect) return <Shortcut keys={keys} className="pointer-coarse:hidden" />;
	return (
		<span className="flex shrink-0">
			<span
				data-pending-question-checkbox=""
				data-checked={checked ? "" : undefined}
				className={
					checked
						? "flex size-3.5 shrink-0 items-center justify-center rounded-r3 bg-primary text-surface-1"
						: "size-3.5 shrink-0 rounded-r3 border border-primary/20"
				}
			>
				{checked && <Check aria-hidden="true" className="size-3" strokeWidth={3} />}
			</span>
		</span>
	);
}

const PENDING_ICON_BUTTON =
	"inline-flex size-6 shrink-0 items-center justify-center rounded-r4 text-secondary enabled:cursor-pointer enabled:hover:bg-fill-ghost-hover enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-50";

const READ_ONLY_OPTION = "flex w-full cursor-not-allowed items-center gap-2 rounded-r4 p-2 bg-alpha-1 text-left";

function optionClass(chosen: boolean): string {
	return `flex w-full cursor-pointer items-center gap-2 rounded-r4 p-2 text-left disabled:cursor-not-allowed ${
		chosen ? "bg-alpha-3 ring-1 ring-accent-100" : "bg-alpha-1 hover:bg-alpha-2"
	}`;
}

const OTHER_TEXTAREA =
	"w-full resize-none rounded-r5 bg-surface-1 px-2 py-1.5 text-body text-primary outline-none ring-1 ring-border placeholder:text-secondary disabled:cursor-not-allowed";
const OTHER_TEXTAREA_READ_ONLY =
	"w-full resize-none cursor-not-allowed rounded-r5 bg-surface-1 px-2 py-1.5 text-body text-primary outline-none ring-1 ring-border placeholder:text-secondary";

/**
 * Upstream's docked question card for the question the session's `PreToolUse`
 * hook reported, drawn as upstream draws it: an i/n pill only for several
 * questions, keycapped options (checkboxes for multi-select), an Other row,
 * Skip and Next/Submit. With `onSubmit` it answers as upstream's does (click
 * or digit keys pick, the Other digit focuses its textarea, ⌘⏎ moves on and
 * submits); without it every control is disabled and the card points at the
 * terminal, the only place left that can answer.
 */
export function PendingQuestionCard({
	questions,
	onSubmit,
}: {
	questions: PendingQuestionItem[];
	/** Sends one answer per question, null for a skipped one; omitted when nothing here can answer. */
	onSubmit?: ((answers: Array<QuestionAnswer | null>) => Promise<void>) | undefined;
}) {
	const answerable = onSubmit !== undefined;
	// One question at a time, as upstream pages them.
	const [page, setPage] = useState(0);
	const [drafts, setDrafts] = useState<QuestionCardDraft[]>(() => questions.map(() => EMPTY_QUESTION_DRAFT));
	const [collapsed, setCollapsed] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const [sending, setSending] = useState<"idle" | "sending" | "sent">("idle");
	const [error, setError] = useState<string | null>(null);
	const otherRef = useRef<HTMLTextAreaElement>(null);
	const questionIndex = Math.min(page, questions.length - 1);
	const isLast = questionIndex === questions.length - 1;
	const question = questions[questionIndex];
	const draft = drafts[questionIndex] ?? EMPTY_QUESTION_DRAFT;
	const editable = answerable && sending === "idle";
	const answered = draftAnswer(draft) !== null;

	const updateDraft = useCallback(
		(update: (current: QuestionCardDraft) => QuestionCardDraft) => {
			setDrafts((current) => current.map((entry, index) => (index === questionIndex ? update(entry) : entry)));
		},
		[questionIndex],
	);

	const submit = useCallback(
		async (finalDrafts: QuestionCardDraft[]) => {
			if (onSubmit === undefined) return;
			setError(null);
			setSending("sending");
			try {
				await onSubmit(questions.map((_, index) => draftAnswer(finalDrafts[index] ?? EMPTY_QUESTION_DRAFT)));
				setSending("sent");
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to send the answer");
				setSending("idle");
			}
		},
		[onSubmit, questions],
	);

	// Next or Submit: paging only reads while read-only; answering needs this question answered first.
	const advance = useCallback(() => {
		if (!answerable) {
			setPage((current) => Math.min(current + 1, questions.length - 1));
			return;
		}
		if (!editable || !answered) return;
		if (isLast) void submit(drafts);
		else setPage(questionIndex + 1);
	}, [answerable, answered, drafts, editable, isLast, questionIndex, questions.length, submit]);

	const skip = useCallback(() => {
		const skipped = drafts.map((entry, index) => (index === questionIndex ? EMPTY_QUESTION_DRAFT : entry));
		setDrafts(skipped);
		if (isLast) void submit(skipped);
		else setPage(questionIndex + 1);
	}, [drafts, isLast, questionIndex, submit]);

	const pickOther = useCallback(() => {
		if (question === undefined) return;
		const chosen = question.multiSelect === true ? !draft.otherChosen : true;
		updateDraft((current) => chooseOther(question, current));
		if (chosen) otherRef.current?.focus();
	}, [draft.otherChosen, question, updateDraft]);

	useEffect(() => {
		if (dismissed || (!answerable && isLast)) return undefined;
		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || event.altKey) return;
			const inCard = event.target instanceof Element && event.target.closest("[data-pending-question]") !== null;
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				if (!inCard && !dockKeyAllowed(event.target)) return;
				event.preventDefault();
				advance();
				return;
			}
			if (!editable || collapsed || event.metaKey || event.ctrlKey || question === undefined) return;
			if (!/^[1-9]$/.test(event.key) || !dockKeyAllowed(event.target)) return;
			const option = Number(event.key) - 1;
			if (option < question.options.length) {
				event.preventDefault();
				updateDraft((current) => pickOption(question, current, option));
			} else if (option === question.options.length) {
				event.preventDefault();
				pickOther();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [advance, answerable, collapsed, dismissed, editable, isLast, pickOther, question, updateDraft]);

	if (question === undefined || dismissed) return null;
	const multiSelect = question.multiSelect === true;
	return (
		<ApprovalCardShell
			stackActions={false}
			label="Waiting for your input"
			body={
				<>
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
								<span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
									<LinkifiedText text={question.question} />
								</span>
							</span>
							<button
								type="button"
								disabled={!answerable}
								data-pending-question-icon
								aria-label="View question options"
								aria-expanded={answerable ? !collapsed : undefined}
								onClick={() => {
									setCollapsed((current) => !current);
								}}
								className={PENDING_ICON_BUTTON}
							>
								<ChevronRight
									aria-hidden="true"
									className={`size-4 transition-transform ${collapsed ? "" : "rotate-90"}`}
								/>
							</button>
							<button
								type="button"
								disabled={!answerable}
								data-pending-question-icon
								aria-label="Dismiss question"
								onClick={() => {
									setDismissed(true);
								}}
								className={PENDING_ICON_BUTTON}
							>
								<X aria-hidden="true" className="size-4" />
							</button>
						</div>
						{!collapsed && (
							<div className="flex flex-col gap-[3px]">
								{question.options.map((option, optionIndex) => {
									const chosen = draft.selected.includes(optionIndex);
									return (
										<button
											key={option.label}
											type="button"
											disabled={!editable}
											data-pending-question-option
											aria-pressed={answerable || multiSelect ? chosen : undefined}
											onClick={() => {
												updateDraft((current) => pickOption(question, current, optionIndex));
											}}
											className={answerable ? optionClass(chosen) : READ_ONLY_OPTION}
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
											<ChoiceMark
												multiSelect={multiSelect}
												keys={String(optionIndex + 1)}
												checked={chosen}
											/>
										</button>
									);
								})}
								<div
									data-pending-question-other
									className={`flex w-full flex-col gap-3 rounded-r4 p-2 ${
										answerable && draft.otherChosen
											? "bg-alpha-3 ring-1 ring-accent-100"
											: "bg-alpha-1"
									}`}
								>
									{multiSelect ? (
										<button
											type="button"
											disabled={!editable}
											aria-pressed={draft.otherChosen}
											onClick={pickOther}
											className={`flex w-full items-center gap-2 text-left ${
												editable ? "cursor-pointer" : "cursor-not-allowed"
											}`}
										>
											<span className="flex-1 text-body text-primary">Other</span>
											<ChoiceMark multiSelect keys="" checked={draft.otherChosen} />
										</button>
									) : (
										<div className="flex items-center gap-2">
											<span className="flex-1 text-body text-primary">Other</span>
											<ChoiceMark
												multiSelect={false}
												keys={String(question.options.length + 1)}
											/>
										</div>
									)}
									<textarea
										ref={otherRef}
										disabled={!editable}
										aria-label="Other option"
										placeholder="Type your own answer here"
										rows={1}
										value={draft.other}
										onFocus={() => {
											if (!multiSelect) updateDraft((current) => chooseOther(question, current));
										}}
										onChange={(event) => {
											const text = event.target.value;
											updateDraft((current) => typeOther(question, current, text));
										}}
										className={answerable ? OTHER_TEXTAREA : OTHER_TEXTAREA_READ_ONLY}
									/>
								</div>
							</div>
						)}
					</div>
					{error !== null && (
						<p data-pending-question-error className="text-footnote text-extended-pink">
							{error}
						</p>
					)}
					{!answerable && (
						<span
							data-pending-question-footnote
							className="flex items-center gap-2 text-footnote text-secondary"
						>
							<span aria-hidden="true" className="status-dot" data-kind="awaiting" />
							{TERMINAL_FOOTNOTE}
						</span>
					)}
				</>
			}
			actions={
				<span className="ms-auto flex items-center gap-2">
					{questionIndex > 0 && (
						<ApprovalActionButton
							variant="secondary"
							disabled={answerable && !editable}
							onClick={() => {
								setPage(questionIndex - 1);
							}}
						>
							Back
						</ApprovalActionButton>
					)}
					<ApprovalActionButton variant="secondary" disabled={!editable} onClick={skip}>
						Skip
					</ApprovalActionButton>
					<ApprovalActionButton
						variant="primary"
						disabled={answerable ? !editable || !answered : isLast}
						onClick={advance}
					>
						{sending === "sending" && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
						{isLast ? "Submit" : "Next"}
						<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
					</ApprovalActionButton>
				</span>
			}
		/>
	);
}
