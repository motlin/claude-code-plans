import {inputString} from "../../lib/tool-utils";
import {Fragment, useState, type ReactNode} from "react";
import {ChevronDown, Loader2} from "lucide-react";
import type {ToolRendererProps} from "./types";
import {useAskUserQuestionContext} from "../ask-user-question-context";
import {MarkdownArticle} from "../markdown-article";
import {defined} from "../../lib/defined";
import {
	answerForQuestion,
	answersFromResultMeta,
	describeAskUserQuestionResult,
	makeInitialDraft,
	normalizeQuestions,
	parseAnswerResult,
	type AskUserQuestionStatus,
	type ParsedAnswer,
	type QuestionDraft,
	type QuestionLike,
} from "../../lib/ask-user-question";

/**
 * Upstream's list-in-card idiom: a hairline-outlined card that clips its rows,
 * separates them with a divider, and pays their padding from the container so
 * every row is full-bleed and content-height.
 */
const CARD_SHELL = "flex flex-col card-outline rounded-r6 overflow-clip divide-y divide-t3 [&>*]:px-p7 [&>*]:py-p6";

function IndexBadge({children, focused}: {children: ReactNode; focused?: boolean}) {
	return (
		<span
			className={`relative flex size-[30px] shrink-0 items-center justify-center rounded-r4 overflow-hidden text-body ${
				focused ? "bg-t4 text-primary" : "bg-t2 text-secondary"
			}`}
		>
			{children}
		</span>
	);
}

function ReadOnlyOption({label, description, index}: {label: string; description?: string | undefined; index: number}) {
	return (
		<div className="flex w-full items-center gap-g6 text-left opacity-50">
			<IndexBadge>{index}</IndexBadge>
			<div className="flex flex-col flex-1 min-w-0">
				<span className="text-body text-primary truncate">{label}</span>
				{description && <span className="text-footnote text-secondary truncate">{description}</span>}
			</div>
		</div>
	);
}

function PencilIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor">
			<path d="M227.31,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.69,147.31,64l24-24L216,84.69Z" />
		</svg>
	);
}

/**
 * True when the user's note adds information beyond the answer value itself.
 * When the user picks 'Other' and types a custom answer, Claude Code echoes
 * the same string in both fields; suppress that redundant duplicate.
 */
function notesAddInformation(notes: string | null, answerValue: string): notes is string {
	if (notes === null) return false;
	const trimmed = notes.trim();
	return trimmed !== "" && trimmed !== answerValue.trim();
}

/**
 * One row of upstream's question receipt: the question in primary w500 over the
 * chosen answer (or the Other text) in secondary. Unchosen options are omitted.
 */
function AnsweredQuestion({question, parsed}: {question: string; parsed: ParsedAnswer}) {
	const answer = parsed.answer.trim();
	return (
		<div data-answered-question className="flex flex-col gap-0.5 px-3 py-2">
			<p className="text-body font-medium text-primary break-words [unicode-bidi:plaintext]">{question}</p>
			{answer !== "" && (
				<p className="text-body text-secondary [overflow-wrap:anywhere] [unicode-bidi:plaintext]">{answer}</p>
			)}
			{notesAddInformation(parsed.notes, answer) && (
				<p className="text-footnote text-secondary italic whitespace-pre-wrap">
					<span className="text-primary">Notes: </span>
					{parsed.notes}
				</p>
			)}
		</div>
	);
}

/**
 * Render a question that has no recorded answer (still pending in an inactive
 * session, docked, or dismissed): the question followed by its options.
 *
 * Emits its blocks as siblings so the enclosing card divides and pads every row
 * itself, matching upstream's list-in-card idiom.
 */
function UnansweredQuestion({question, header, options}: QuestionLike) {
	return (
		<>
			<div>
				{header && <p className="text-footnote text-secondary mb-g3">{header}</p>}
				<MarkdownArticle markdown={question} />
			</div>
			{options.map((opt, optionIndex) => (
				<ReadOnlyOption
					key={opt.label}
					label={opt.label}
					description={opt.description}
					index={optionIndex + 1}
				/>
			))}
		</>
	);
}

function StatusLine({status}: {status: AskUserQuestionStatus}) {
	return (
		<div className="text-body text-extended-pink">
			<div>{status.text}</div>
			{status.detail && <div className="text-secondary whitespace-pre-wrap">{status.detail}</div>}
		</div>
	);
}

/**
 * Interactive answer form rendered when the session is active and the question
 * is still pending. Renders the same options as the read-only view but lets
 * the user pick one (or many, if multiSelect) plus a free-text 'Other' field.
 */
function AnswerForm({
	questions,
	onSubmit,
}: {
	questions: QuestionLike[];
	onSubmit: (answers: Array<{question: string; answer: string}>) => Promise<void>;
}) {
	const [drafts, setDrafts] = useState<QuestionDraft[]>(() => questions.map(() => makeInitialDraft()));
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const completed = questions.every(
		(q, i) => answerForQuestion(q, defined(drafts[i], "AskUserQuestion draft missing for its question")) !== null,
	);

	function updateDraft(index: number, mutator: (draft: QuestionDraft) => QuestionDraft) {
		setDrafts((prev) => prev.map((d, i) => (i === index ? mutator(d) : d)));
	}

	function toggleOption(index: number, label: string) {
		updateDraft(index, (draft) => {
			const next: QuestionDraft = {
				selected: new Set(draft.selected),
				otherText: draft.otherText,
				useOther: false,
			};
			if (questions[index]?.multiSelect === true) {
				if (next.selected.has(label)) {
					next.selected.delete(label);
				} else {
					next.selected.add(label);
				}
			} else {
				next.selected = new Set([label]);
			}
			return next;
		});
	}

	function selectOther(index: number) {
		updateDraft(index, (draft) => ({
			selected: new Set(),
			otherText: draft.otherText,
			useOther: true,
		}));
	}

	function setOtherText(index: number, value: string) {
		updateDraft(index, (draft) => ({
			selected: draft.selected,
			otherText: value,
			useOther: true,
		}));
	}

	async function handleSubmit() {
		if (!completed || submitting) return;
		setError(null);
		setSubmitting(true);
		try {
			const answers = questions.map((q, i) => ({
				question: q.question,
				answer:
					answerForQuestion(q, defined(drafts[i], "AskUserQuestion draft missing for its question")) ?? "",
			}));
			await onSubmit(answers);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to submit answer");
			setSubmitting(false);
		}
	}

	async function handleSkip() {
		if (submitting) return;
		setError(null);
		setSubmitting(true);
		try {
			const answers = questions.map((q) => ({
				question: q.question,
				answer: "",
			}));
			await onSubmit(answers);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to skip");
			setSubmitting(false);
		}
	}

	return (
		<div className={CARD_SHELL}>
			{questions.map((q, index) => {
				const draft = defined(drafts[index], "AskUserQuestion draft missing for its question");
				const isMulti = q.multiSelect ?? false;
				return (
					<Fragment key={index}>
						<div className="flex items-start gap-g6">
							<div className="flex-1 min-w-0">
								<MarkdownArticle markdown={q.question} />
							</div>
							{q.header && <span className="text-footnote text-secondary shrink-0">{q.header}</span>}
						</div>
						{q.options.map((opt, optionIndex) => {
							const selected = draft.selected.has(opt.label) && !draft.useOther;
							return (
								<button
									key={opt.label}
									type="button"
									onClick={() => {
										toggleOption(index, opt.label);
									}}
									disabled={submitting}
									className={`flex w-full items-center gap-g6 text-left cursor-pointer transition-colors ${
										selected ? "bg-t2" : "hover:bg-t1"
									} disabled:cursor-not-allowed disabled:opacity-50`}
								>
									{isMulti ? (
										<div className="flex size-[30px] shrink-0 items-center justify-center">
											<input
												type="checkbox"
												checked={selected}
												readOnly
												className="w-5 h-5 pointer-events-none"
											/>
										</div>
									) : (
										<IndexBadge focused={selected}>{optionIndex + 1}</IndexBadge>
									)}
									<div className="flex flex-col flex-1 min-w-0">
										<span
											className={`text-body truncate ${selected ? "text-primary" : "text-secondary"}`}
										>
											{opt.label}
										</span>
										{opt.description && (
											<span className="text-footnote text-secondary truncate">
												{opt.description}
											</span>
										)}
									</div>
									{selected && !isMulti && (
										<span className="text-secondary text-body shrink-0" aria-hidden="true">
											⏎
										</span>
									)}
								</button>
							);
						})}
						{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer shortcut for the Other radio and textarea inside it, which are keyboard-reachable themselves */}
						<div
							className={`flex w-full items-center gap-g6 text-left cursor-text ${
								draft.useOther ? "bg-t2" : "hover:bg-t1"
							}`}
							onClick={() => {
								selectOther(index);
							}}
						>
							{isMulti ? (
								<div className="flex size-[30px] shrink-0 items-center justify-center">
									<input
										type="checkbox"
										checked={draft.useOther && draft.otherText.trim().length > 0}
										readOnly
										className="w-5 h-5 pointer-events-none"
									/>
								</div>
							) : (
								<IndexBadge focused={draft.useOther}>
									<PencilIcon />
								</IndexBadge>
							)}
							<input
								type="text"
								value={draft.otherText}
								onChange={(e) => {
									setOtherText(index, e.target.value);
								}}
								onFocus={() => {
									selectOther(index);
								}}
								disabled={submitting}
								placeholder="Type your answer"
								className="flex-1 min-w-0 w-full bg-transparent text-body text-primary placeholder:text-secondary outline-none ring-0 border-0 shadow-none focus:ring-0 focus:!outline-none focus:border-0 focus:shadow-none"
							/>
						</div>
						{isMulti && <p className="text-footnote text-secondary italic">Select one or more options.</p>}
					</Fragment>
				);
			})}
			{error && <div className="text-footnote text-extended-pink">{error}</div>}
			<div className="flex items-center justify-end gap-g6">
				<button
					type="button"
					onClick={() => {
						void handleSkip();
					}}
					disabled={submitting}
					className="inline-flex items-center gap-g3 rounded-r4 card-outline px-p7 py-p5 text-footnote font-medium text-secondary hover:bg-t1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
				>
					Skip
				</button>
				<button
					type="button"
					onClick={() => {
						void handleSubmit();
					}}
					disabled={!completed || submitting}
					className="inline-flex items-center gap-g3 rounded-r4 bg-accent-100 px-p7 py-p5 text-footnote font-medium text-white hover:bg-accent-100/80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
				>
					{submitting ? <Loader2 size={12} className="animate-spin" /> : null}
					{submitting ? "Submitting..." : "Submit"}
				</button>
			</div>
		</div>
	);
}

/**
 * Upstream's transcript row for a question still waiting on the user: a running
 * "Asking <header>" row, expanded, over each question as one secondary
 * paragraph (its line breaks collapse; the docked card keeps them), both at
 * the assistant text inset. The
 * options live only in the card docked above the composer.
 */
function PendingAsking({questions}: {questions: QuestionLike[]}) {
	const [expanded, setExpanded] = useState(true);
	const header = questions[0]?.header ?? "a question";
	return (
		<div className="flex flex-col ps-1">
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => {
					setExpanded((open) => !open);
				}}
				className="inline-flex w-fit cursor-pointer items-center gap-g5 text-body"
			>
				<span className="text-secondary tool-shimmer">Asking {header}</span>
				<ChevronDown
					aria-hidden="true"
					className={`size-3 shrink-0 text-secondary transition-transform ${expanded ? "" : "-rotate-90"}`}
				/>
			</button>
			{expanded && (
				<div className="flex flex-col gap-1 pt-1">
					{questions.map((question, index) => (
						<div
							key={index}
							data-pending-question-text=""
							className="text-body text-secondary [overflow-wrap:anywhere]"
						>
							{question.question}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export function AskUserQuestionRenderer({toolCall}: ToolRendererProps) {
	const ctx = useAskUserQuestionContext();
	const questions = normalizeQuestions(toolCall.input);
	const {result} = toolCall;
	const isPending = result === undefined;

	if (isPending && questions !== null && ctx?.dockedToolUseId === toolCall.id) {
		return <PendingAsking questions={questions} />;
	}
	const canAnswer = ctx?.isSessionActive === true && isPending && questions !== null;

	if (canAnswer) {
		return (
			<AnswerForm
				questions={questions}
				onSubmit={async (answers) => ctx.submitAnswer({toolUseId: toolCall.id, answers})}
			/>
		);
	}

	if (isPending && questions !== null) return <PendingAsking questions={questions} />;

	const status = describeAskUserQuestionResult(result);

	if (!questions) {
		const singleQuestion = inputString(toolCall.input, "question") ?? "";
		return (
			<div className={CARD_SHELL}>
				<div>
					<MarkdownArticle markdown={singleQuestion} />
				</div>
				{status && <StatusLine status={status} />}
				{!status && result !== undefined && (
					<p className="text-body text-secondary whitespace-pre-wrap">{result}</p>
				)}
			</div>
		);
	}

	const parsed =
		result === undefined
			? null
			: (answersFromResultMeta(toolCall.resultMeta, questions) ?? parseAnswerResult(result, questions));
	if (parsed !== null) {
		// Upstream's `epitaxy-question-receipt`: every answered pair of one call in a 480px card,
		// divided by its ring's hairline, 3px nearer the row above and 7px further from the next.
		return (
			<div className="card-ring -mt-[3px] mb-[7px] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text">
				{parsed.map((entry, i) => (
					<AnsweredQuestion key={i} question={entry.question} parsed={entry} />
				))}
			</div>
		);
	}

	// Parsing can fail when the result text predates the canonical envelope
	// or has an unexpected shape. Fall back to displaying the raw text so we
	// don't silently lose information.
	const showRawFallback = result !== undefined && status === null;

	return (
		<div className={CARD_SHELL}>
			{questions.map((q, i) => (
				<UnansweredQuestion
					key={i}
					question={q.question}
					{...(q.header ? {header: q.header} : {})}
					options={q.options}
				/>
			))}
			{status && <StatusLine status={status} />}
			{showRawFallback && <p className="text-body text-secondary whitespace-pre-wrap">{result}</p>}
		</div>
	);
}
