import {ChevronRight, Loader2, X} from "lucide-react";
import {useCallback, useEffect, useReducer, useRef, useState} from "react";

import {
	approvalDockAnswers,
	approvalDockReducer,
	currentAnswered,
	initialApprovalDockState,
	type ApprovalDockAction,
	type ApprovalDockState,
} from "../lib/approval-dock";
import type {QuestionLike} from "../lib/ask-user-question";
import {dockKeyAllowed} from "../lib/dock-keys";
import {APPROVAL_CARD_TITLE, ApprovalActionButton, ApprovalCardShell} from "./approval-card";
import {Shortcut} from "./ui/shortcut";

export interface ApprovalDockSubmission {
	toolUseId: string;
	answers: Array<{question: string; answer: string}>;
}

const ICON_BUTTON =
	"inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r4 text-secondary hover:bg-fill-ghost-hover hover:text-primary";

/**
 * The needs-input card docked above the composer for a pending AskUserQuestion,
 * copied from claude.ai/code's approval card: an i/n pill, options with 1…n
 * keycaps, an Other textarea, and Skip / Next / Submit.
 */
export function ApprovalDock({
	toolUseId,
	questions,
	onSubmit,
	onDismiss,
}: {
	toolUseId: string;
	questions: QuestionLike[];
	onSubmit: (submission: ApprovalDockSubmission) => Promise<void>;
	/** Called after Dismiss, so the page can hand the question back to the inline form. */
	onDismiss?: () => void;
}) {
	const [state, rawDispatch] = useReducer(
		(current: ApprovalDockState, action: ApprovalDockAction) => approvalDockReducer(current, action, questions),
		questions,
		initialApprovalDockState,
	);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const otherRef = useRef<HTMLTextAreaElement>(null);

	const question = questions[state.index]!;
	const draft = state.drafts[state.index]!;
	const isLast = state.index === questions.length - 1;
	const answered = currentAnswered(questions, state);
	const open = !state.collapsed && !state.dismissed;

	const submit = useCallback(
		async (finalState: ApprovalDockState) => {
			setError(null);
			setSubmitting(true);
			try {
				await onSubmit({toolUseId, answers: approvalDockAnswers(questions, finalState)});
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to submit answer");
				setSubmitting(false);
			}
		},
		[onSubmit, toolUseId, questions],
	);

	useEffect(() => {
		if (!open || submitting) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
			if (!/^[1-9]$/.test(event.key) || !dockKeyAllowed(event.target)) return;
			const option = Number(event.key) - 1;
			if (option < question.options.length) {
				event.preventDefault();
				rawDispatch({type: "select", option});
			} else if (option === question.options.length) {
				event.preventDefault();
				rawDispatch({type: "selectOther"});
				otherRef.current?.focus();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, submitting, question]);

	if (state.dismissed) return null;

	function handleSkip() {
		if (isLast) void submit(approvalDockReducer(state, {type: "skip"}, questions));
		else rawDispatch({type: "skip"});
	}

	function handleNext() {
		if (!answered) return;
		if (isLast) void submit(state);
		else rawDispatch({type: "next"});
	}

	const otherKey = String(question.options.length + 1);

	return (
		<ApprovalCardShell
			body={
				<>
					<div className="flex items-start gap-2">
						<span className="flex h-6 shrink-0 items-center">
							<span
								data-approval-pill
								className="rounded-full bg-warning-100/10 px-1.5 text-caption text-warning-000"
							>
								{state.index + 1}/{questions.length}
							</span>
						</span>
						<div className="min-w-0 flex-1">
							<span data-approval-question data-approval-card-title className={APPROVAL_CARD_TITLE}>
								{question.question}
							</span>
						</div>
						<button
							type="button"
							aria-label="View question options"
							aria-expanded={!state.collapsed}
							onClick={() => rawDispatch({type: "toggleCollapsed"})}
							className={ICON_BUTTON}
						>
							<ChevronRight
								aria-hidden="true"
								className={`size-4 transition-transform ${state.collapsed ? "" : "rotate-90"}`}
							/>
						</button>
						<button
							type="button"
							aria-label="Dismiss question"
							onClick={() => {
								rawDispatch({type: "dismiss"});
								onDismiss?.();
							}}
							className={ICON_BUTTON}
						>
							<X aria-hidden="true" className="size-4" />
						</button>
					</div>
					{!state.collapsed && (
						<>
							{question.options.map((option, optionIndex) => {
								const selected = !draft.useOther && draft.selected.has(option.label);
								return (
									<button
										key={option.label}
										type="button"
										aria-pressed={selected}
										disabled={submitting}
										onClick={() => rawDispatch({type: "select", option: optionIndex})}
										className={`flex w-full cursor-pointer items-center gap-2 rounded-r4 px-3 py-3 text-left disabled:cursor-not-allowed ${
											selected
												? "bg-alpha-3 ring-1 ring-accent-100"
												: "bg-alpha-1 hover:bg-alpha-2"
										}`}
									>
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="text-body text-primary">{option.label}</span>
											{option.description && (
												<span className="text-footnote text-secondary">
													{option.description}
												</span>
											)}
										</span>
										<Shortcut keys={String(optionIndex + 1)} className="pointer-coarse:hidden" />
									</button>
								);
							})}
							<label
								className={`flex w-full flex-col gap-1 rounded-r4 px-3 py-3 ${
									draft.useOther ? "bg-alpha-3 ring-1 ring-accent-100" : "bg-alpha-1"
								}`}
							>
								<span className="flex items-center gap-2">
									<span className="flex-1 text-body text-primary">Other</span>
									<Shortcut keys={otherKey} className="pointer-coarse:hidden" />
								</span>
								<textarea
									ref={otherRef}
									aria-label="Other option"
									placeholder="Type your own answer here"
									rows={1}
									value={draft.otherText}
									disabled={submitting}
									onFocus={() => rawDispatch({type: "selectOther"})}
									onChange={(event) => rawDispatch({type: "setOtherText", text: event.target.value})}
									className="max-h-[calc(4lh)] w-full resize-none bg-transparent text-body text-primary outline-none [field-sizing:content] placeholder:text-secondary"
								/>
							</label>
						</>
					)}
					{question.multiSelect && !state.collapsed && (
						<p className="text-footnote text-secondary">Select one or more options.</p>
					)}
					{error && <p className="text-footnote text-extended-pink">{error}</p>}
				</>
			}
			actions={
				<>
					<ApprovalActionButton variant="secondary" onClick={handleSkip} disabled={submitting}>
						Skip
					</ApprovalActionButton>
					<ApprovalActionButton variant="primary" onClick={handleNext} disabled={!answered || submitting}>
						{submitting && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
						{isLast ? "Submit" : "Next"}
					</ApprovalActionButton>
				</>
			}
		/>
	);
}
