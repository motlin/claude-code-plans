import {inputString} from "../../lib/tool-utils";
import type {ReactNode} from "react";
import type {ToolRendererProps} from "./types";
import {useAskUserQuestionContext} from "../ask-user-question-context";
import {MarkdownArticle} from "../markdown-article";
import {QuestionCard} from "../question-card";
import {FORK_ANSWER_LABEL} from "../../lib/question-answer-route";
import type {QuestionAnswer} from "../../lib/hook-events";
import {labelledAnswers} from "../../lib/question-card-draft";
import {
	answersFromResultMeta,
	describeAskUserQuestionResult,
	normalizeQuestions,
	parseAnswerResult,
	type AskUserQuestionStatus,
	type ParsedAnswer,
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

export function AskUserQuestionRenderer({toolCall}: ToolRendererProps) {
	const ctx = useAskUserQuestionContext();
	const questions = normalizeQuestions(toolCall.input);
	const {result} = toolCall;
	const isPending = result === undefined;

	// Upstream draws a pending question as its card, inline where the call is; it answers along the session's route.
	if (isPending && questions !== null) {
		const route = ctx?.answerRoute ?? "read-only";
		const submit =
			ctx !== null && route !== "read-only"
				? async (answers: Array<QuestionAnswer | null>) =>
						ctx.submitAnswer({
							toolUseId: toolCall.id,
							questions,
							answers: labelledAnswers(questions, answers),
						})
				: undefined;
		return (
			<QuestionCard
				draftKey={toolCall.id}
				questions={questions}
				onSubmit={submit}
				{...(route === "fork" ? {submitLabel: FORK_ANSWER_LABEL} : {})}
			/>
		);
	}

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
