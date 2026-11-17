import {ApprovalSlot} from "./approval-slot";
import type {AskUserQuestionContextValue} from "./ask-user-question-context";
import {QuestionCard} from "./question-card";
import type {ApprovalPresentation} from "../lib/approval-presentation";
import {sessionApprovalSlotCard} from "../lib/approval-slot-card";
import type {QuestionLike} from "../lib/ask-user-question";
import type {QuestionAnswer} from "../lib/hook-events";
import {FORK_ANSWER_LABEL} from "../lib/question-answer-route";

export interface PendingQuestionCardProps
{
	toolUseId: string;
	questions: QuestionLike[];
	ctx: AskUserQuestionContextValue | null;
	/** The answer was already sent from a card for this call. */
	sent: boolean;
	presentation?: ApprovalPresentation;
}

/**
 * A pending question's card, answering along the session's route; in a session, inside its own approval slot so a
 * keyboard answer hands focus to the composer. Drawn in the question's transcript row, or docked by the session.
 * Returned as elements, not a component, so the row's card keeps its node when the result swaps it for the sent
 * receipt's `QuestionCard`.
 */
export function pendingQuestionCard({toolUseId, questions, ctx, sent, presentation = "card"}: PendingQuestionCardProps)
{
	const route = ctx?.answerRoute ?? "read-only";
	const submit =
		ctx !== null && route !== "read-only"
			? async (answers: Array<QuestionAnswer | null>) =>
					ctx.submitAnswer(
						{
							toolUseId,
							questions,
							picks: answers,
						},
					)
			: undefined;
	const card = (
		<QuestionCard
			draftKey={toolUseId}
			questions={questions}
			onSubmit={submit}
			// A fork answers in a new session, so only a live answer holds this one as working.
			sessionId={route === "live-pane" ? ctx?.sessionId : undefined}
			presentation={presentation}
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
					questionId: sent ? null : toolUseId,
				},
			)}
		>
			{card}
		</ApprovalSlot>
	);
}
