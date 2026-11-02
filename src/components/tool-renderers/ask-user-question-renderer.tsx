import {inputString} from "../../lib/tool-utils";
import {useEffect, useRef} from "react";
import type {ClientToolCall, ToolRendererProps} from "./types";
import {useAskUserQuestionContext} from "../ask-user-question-context";
import {MarkdownArticle} from "../markdown-article";
import {FallbackRenderer} from "./fallback-renderer";
import {ApprovalSlot} from "../approval-slot";
import {sessionApprovalSlotCard} from "../../lib/approval-slot-card";
import {QuestionCard} from "../question-card";
import {QuestionReceipt} from "../question-receipt";
import {UserInlineText} from "../user-plain-text";
import {maskSecrets} from "../../lib/secret-mask";
import {revealSpoofing} from "../../lib/visible-text";
import {removeMemoryTags} from "../../lib/task-checklist";
import {FORK_ANSWER_LABEL} from "../../lib/question-answer-route";
import type {QuestionAnswer} from "../../lib/hook-events";
import {clearSentQuestionCard, isQuestionCardSent, useQuestionCardSent} from "../../lib/question-card-store";
import
{
	describeAskUserQuestionResult,
	isWithdrawnQuestion,
	normalizeQuestions,
	OUTCOME_LABEL,
	parseAnswerResult,
	questionOutcomes,
	type AskUserQuestionStatus,
	type QuestionLike,
} from "../../lib/ask-user-question";

/**
 * Upstream's list-in-card idiom: a hairline-outlined card that clips its rows,
 * separates them with a divider, and pays their padding from the container so
 * every row is full-bleed and content-height.
 */
const CARD_SHELL = "flex flex-col card-outline rounded-r6 overflow-clip divide-y divide-t3 [&>*]:px-p7 [&>*]:py-p6";

/**
 * Upstream's `gy` > `_y` (cb6930dae, 2026-11-10) for a call with no result outside a session: only the question lines,
 * each with its memory tags dropped (`Zp` over `sh`) and drawn as `_i({text: u9(ME(question))})` in
 * secondary text; no header and no options. Nothing when no question has text.
 */
function UnansweredQuestions({questions}: {questions: QuestionLike[]})
{
	const lines = questions.flatMap((q) => (q.question ? [removeMemoryTags(q.question)] : []));
	if (lines.length === 0) return null;
	return (
		<div className="flex flex-col gap-1 pt-xs">
			{lines.map((line, i) => (
				<div key={`${i}-${line}`} className="text-body text-secondary [overflow-wrap:anywhere]">
					<UserInlineText text={revealSpoofing(maskSecrets(line))} codeLook="chip" links={false} />
				</div>
			))}
		</div>
	);
}

/**
 * Upstream's step body for a question nobody answered: each question in plain
 * secondary text over its answer, or, when the call asked several questions,
 * its outcome's word ("Not answered" when the call was stopped). A single
 * unanswered question shows only itself, since the row's note already says why.
 * The question line is masked then revealed: upstream draws it as `_i({text: u9(ME(question))})`
 * (cb6930dae, 2026-11-10), where ME is the secret masker, u9 shows spoofing characters as
 * `[U+XXXX]` and `_i` paints code chips. The answer line is `u9(ME(answer))` as plain text.
 */
function QuestionOutcomeList({toolCall}: {toolCall: ClientToolCall})
{
	const entries = questionOutcomes(toolCall);
	return (
		<div className="flex flex-col gap-3 pt-1">
			{entries.map((entry, i) =>
			{
				const kind = entry.unanswered ?? (toolCall.stopped === true ? "dismissed" : undefined);
				const line =
					entry.answer === undefined
						? kind !== undefined && entries.length > 1
							? OUTCOME_LABEL[kind]
							: undefined
						: revealSpoofing(maskSecrets(entry.answer));
				return (
					<div key={i} className="flex flex-col text-body [overflow-wrap:anywhere]">
						<div className="text-secondary">
							<UserInlineText
								text={revealSpoofing(maskSecrets(entry.question))}
								codeLook="chip"
								links={false}
							/>
						</div>
						{line !== undefined && <div className="text-ink-muted">{line}</div>}
					</div>
				);
			})}
		</div>
	);
}

function StatusLine({status}: {status: AskUserQuestionStatus})
{
	return (
		<div className="text-body text-extended-pink">
			<div>{status.text}</div>
			{status.detail && <div className="text-secondary whitespace-pre-wrap">{status.detail}</div>}
		</div>
	);
}

/** The notes the user typed per question, from the structured result or else the result text. */
function recordedNotes(
	meta: ClientToolCall["resultMeta"],
	result: string | undefined,
	questions: QuestionLike[],
): Map<string, string | null>
{
	const notes = new Map<string, string | null>();
	if (meta?.answers !== undefined)
	{
		for (const [question, entry] of Object.entries(meta.answers)) notes.set(question, entry.notes);
	}
	else if (result !== undefined)
	{
		for (const entry of parseAnswerResult(result, questions) ?? []) notes.set(entry.question, entry.notes);
	}
	return notes;
}

export function AskUserQuestionRenderer({toolCall}: ToolRendererProps)
{
	const ctx = useAskUserQuestionContext();
	const questions = normalizeQuestions(toolCall.input);
	const {result} = toolCall;
	const isPending = result === undefined;
	// Upstream's sent store holds the submitted answers only until the call's result lands.
	useEffect(() =>
	{
		if (!isPending) clearSentQuestionCard(toolCall.id);
	}, [isPending, toolCall.id]);
	// Whether this renderer's own card sent the answer while the call was pending:
	// then that card's sent receipt already faded in, and the result keeps its node.
	const sentNow = useQuestionCardSent(toolCall.id);
	const sentHereRef = useRef(false);
	if (isPending) sentHereRef.current = sentNow;
	// Upstream's wd fades the receipt in when the result lands with the sent store holding
	// the answer, decided the render the result first appears; a terminal answer never fades.
	const receiptEntersRef = useRef<boolean | null>(null);
	if (isPending) receiptEntersRef.current = null;
	else receiptEntersRef.current ??= isQuestionCardSent(toolCall.id) && !sentHereRef.current;

	// Upstream's `gy` (cb6930dae): outside a session (no `vp` provider), a call with no result is only its question lines.
	if (isPending && questions !== null && ctx === null) return <UnansweredQuestions questions={questions} />;

	// Upstream draws a pending question as its card, inline where the call is; it answers along the session's route.
	if (isPending && questions !== null)
	{
		const route = ctx?.answerRoute ?? "read-only";
		const submit =
			ctx !== null && route !== "read-only"
				? async (answers: Array<QuestionAnswer | null>) =>
						ctx.submitAnswer(
							{
								toolUseId: toolCall.id,
								questions,
								picks: answers,
							},
						)
				: undefined;
		const card = (
			<QuestionCard
				draftKey={toolCall.id}
				questions={questions}
				onSubmit={submit}
				// A fork answers in a new session, so only a live answer holds this one as working.
				sessionId={route === "live-pane" ? ctx?.sessionId : undefined}
				{...(route === "fork"
					?
						{
							submitLabel: FORK_ANSWER_LABEL,
						}
					: {})}
			/>
		);
		if (ctx?.sessionId === undefined) return card;
		// Upstream's slot for a question drawn in its transcript row: a keyboard answer hands focus to the composer.
		return (
			<ApprovalSlot
				sessionId={ctx.sessionId}
				{...sessionApprovalSlotCard(
					{
						permission: null,
						planId: null,
						questionId: sentNow ? null : toolCall.id,
					},
				)}
			>
				{card}
			</ApprovalSlot>
		);
	}

	const status = describeAskUserQuestionResult(result);

	if (!questions)
	{
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

	// Parsing can fail when the result text predates the canonical envelope
	// or has an unexpected shape. Fall back to displaying the raw text so we
	// don't silently lose information.
	const showRawFallback =
		result !== undefined &&
		status === null &&
		toolCall.resultMeta?.answers === undefined &&
		parseAnswerResult(result, questions) === null;

	if (isWithdrawnQuestion(toolCall))
	{
		return (
			<>
				<QuestionOutcomeList toolCall={toolCall} />
				{status && toolCall.stopped !== true && <StatusLine status={status} />}
				{showRawFallback && <p className="text-body text-secondary whitespace-pre-wrap">{result}</p>}
			</>
		);
	}

	// Upstream's receipt keeps every question with an answer or an outcome, and drops the rest.
	const receipt = questionOutcomes(toolCall).filter(
		(entry) => entry.answer !== undefined || entry.unanswered !== undefined,
	);
	if (receipt.length > 0)
	{
		const notes = recordedNotes(toolCall.resultMeta, result, questions);
		const rows = receipt.map((entry) => (
		{
			question: entry.question,
			answer: entry.answer ?? (entry.unanswered === undefined ? "" : OUTCOME_LABEL[entry.unanswered]),
			notes: notes.get(entry.question) ?? null,
		}));
		// The card that sent the answer stays mounted to draw the result in its sent receipt's node.
		if (sentHereRef.current) return <QuestionCard draftKey={toolCall.id} questions={questions} answered={rows} />;
		return <QuestionReceipt enters={receiptEntersRef.current ?? false} rows={rows} />;
	}

	// Upstream's `Ev` sends any other question call with a result (an error) down the generic tool body.
	return <FallbackRenderer toolCall={toolCall} />;
}
