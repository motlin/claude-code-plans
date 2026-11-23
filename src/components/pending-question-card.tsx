import type {ReactElement} from "react";
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
	/** Upstream's `queueDepth`: the other requests pending behind this one, drawn as ghosts while docked. */
	queueDepth?: number;
}

/**
 * A pending question's card, answering along the session's route; in a session, inside its own approval slot so a
 * keyboard answer hands focus to the composer. Drawn in the question's transcript row, or docked by the session.
 * Returned as elements, not a component, so the row's card keeps its node when the result swaps it for the sent
 * receipt's `QuestionCard`.
 */
export function pendingQuestionCard({
	toolUseId,
	questions,
	ctx,
	sent,
	presentation = "card",
	queueDepth = 0,
}: PendingQuestionCardProps)
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
			queueDepth={queueDepth}
			{...(route === "fork"
				?
					{
						submitLabel: FORK_ANSWER_LABEL,
					}
				: {})}
		/>
	);
	return inQuestionSlot(ctx?.sessionId, sent ? null : toolUseId, card);
}

/**
 * A question's card inside its session's approval slot, or bare outside a session. The row's sent card goes through
 * here too, so the element tree keeps its types from pending to answered and React keeps the card's node.
 */
export function inQuestionSlot(sessionId: string | undefined, questionId: string | null, card: ReactElement)
{
	if (sessionId === undefined) return card;
	// Upstream's slot for a question drawn in its transcript row: a keyboard answer hands focus to the composer.
	return (
		<ApprovalSlot
			sessionId={sessionId}
			{...sessionApprovalSlotCard(
				{
					permission: null,
					planId: null,
					questionId,
				},
			)}
		>
			{card}
		</ApprovalSlot>
	);
}
