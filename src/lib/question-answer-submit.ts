import {postAnswerQuestion} from "./api/answer-question";
import {sendHerdrQuestionAnswer} from "./api/herdr";
import type {QuestionLike} from "./ask-user-question";
import type {QuestionAnswer} from "./hook-events";
import {READ_ONLY_ANSWER_HINT, type QuestionAnswerRoute} from "./question-answer-route";

// Loaded on submit, so the cards' entry chunks carry only the route.

interface LabelAnswer {
	question: string;
	answer: string;
}

function optionIndex(question: QuestionLike, label: string): number {
	return question.options.findIndex((option) => option.label === label);
}

function paneAnswer(question: QuestionLike, answer: string): QuestionAnswer | null {
	if (answer === "") return null;
	const exact = optionIndex(question, answer);
	if (exact >= 0) return {selected: [exact]};
	if (question.multiSelect === true) {
		const indices = answer.split(", ").map((label) => optionIndex(question, label));
		if (indices.every((index) => index >= 0)) return {selected: indices.toSorted((a, b) => a - b)};
	}
	return {selected: [], other: answer};
}

/** The cards' label answers, in question order, as the option picks `/api/herdr/question` types. */
export function labelAnswersToPaneAnswers(
	questions: readonly QuestionLike[],
	answers: readonly LabelAnswer[],
): Array<QuestionAnswer | null> {
	return questions.map((question, index) => paneAnswer(question, answers[index]?.answer ?? ""));
}

export interface QuestionAnswerSubmission {
	sessionId: string;
	toolUseId: string;
	questions: readonly QuestionLike[];
	answers: LabelAnswer[];
}

/** Send a question card's answer along its route; the read-only route refuses. */
export async function submitQuestionAnswer(
	route: QuestionAnswerRoute,
	{sessionId, toolUseId, questions, answers}: QuestionAnswerSubmission,
): Promise<void> {
	switch (route) {
		case "live-pane":
			await sendHerdrQuestionAnswer(sessionId, toolUseId, labelAnswersToPaneAnswers(questions, answers));
			return;
		case "fork":
			await postAnswerQuestion({sessionId, toolUseId, answers});
			return;
		case "read-only":
			throw new Error(READ_ONLY_ANSWER_HINT);
	}
}
