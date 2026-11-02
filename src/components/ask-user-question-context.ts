import {createContext, useContext} from "react";

import type {QuestionLike} from "../lib/ask-user-question";
import type {QuestionAnswer} from "../lib/hook-events";
import type {QuestionAnswerRoute} from "../lib/question-answer-route";

export interface AnswerSubmission
{
	toolUseId: string;
	questions: readonly QuestionLike[];
	/** The card's picks, one per question, null for a skip. */
	picks: ReadonlyArray<QuestionAnswer | null>;
}

export interface AskUserQuestionContextValue
{
	/** The session the questions belong to; a live answer holds it as answered. */
	sessionId?: string;
	/**
	 * Where an answer to the session's pending question goes: its live pane, a
	 * new fork (only once the session stopped running), or nowhere (read-only).
	 */
	answerRoute: QuestionAnswerRoute;
	/** Whether the session's CLI still runs; null or omitted while unknown. */
	sessionLive?: boolean | null;
	/**
	 * Submit an answer to a pending AskUserQuestion along `answerRoute`. Rejects
	 * with an error the caller shows; the caller owns any feedback while awaiting.
	 */
	submitAnswer: (submission: AnswerSubmission) => Promise<void>;
}

const AskUserQuestionContext = createContext<AskUserQuestionContextValue | null>(null);

export const AskUserQuestionProvider = AskUserQuestionContext.Provider;

/**
 * Returns the AskUserQuestion context if a provider is mounted, otherwise null.
 * Renderers used outside a session view (e.g. source view, tests) get null and
 * fall back to read-only display.
 */
export function useAskUserQuestionContext(): AskUserQuestionContextValue | null
{
	return useContext(AskUserQuestionContext);
}
