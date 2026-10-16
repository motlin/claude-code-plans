import {createContext, useContext} from "react";

import type {QuestionLike} from "../lib/ask-user-question";
import type {QuestionAnswerRoute} from "../lib/question-answer-route";

export interface AnswerSubmission {
	toolUseId: string;
	questions: readonly QuestionLike[];
	answers: Array<{question: string; answer: string}>;
}

export interface AskUserQuestionContextValue {
	/**
	 * Where an answer to the session's pending question goes: its live pane, a
	 * new fork (only once the session stopped running), or nowhere (read-only).
	 */
	answerRoute: QuestionAnswerRoute;
	/**
	 * Submit an answer to a pending AskUserQuestion along `answerRoute`. Rejects
	 * with an error the caller shows; the caller owns any feedback while awaiting.
	 */
	submitAnswer: (submission: AnswerSubmission) => Promise<void>;
	/**
	 * The pending question currently docked above the composer, if any. Its
	 * inline renderer collapses to an "Asking <header>" summary instead of a form.
	 */
	dockedToolUseId?: string | null;
}

const AskUserQuestionContext = createContext<AskUserQuestionContextValue | null>(null);

export const AskUserQuestionProvider = AskUserQuestionContext.Provider;

/**
 * Returns the AskUserQuestion context if a provider is mounted, otherwise null.
 * Renderers used outside a session view (e.g. source view, tests) get null and
 * fall back to read-only display.
 */
export function useAskUserQuestionContext(): AskUserQuestionContextValue | null {
	return useContext(AskUserQuestionContext);
}
