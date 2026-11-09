import {postAnswerQuestion} from "./api/answer-question";
import {sendHerdrQuestionAnswer} from "./api/herdr";
import type {QuestionLike} from "./ask-user-question";
import type {QuestionAnswer} from "./hook-events";
import {NO_PREFERENCE_ANSWER, type QuestionResponse, questionResponses} from "./question-card-draft";
import {READ_ONLY_ANSWER_HINT, type QuestionAnswerRoute} from "./question-answer-route";

// Loaded on submit, so the cards' entry chunks carry only the route.

/**
 * Upstream's `xt` for one question: each element matched to an option by its exact label, any other text as Other.
 * Unlike `xt`, `Something else` stays Other text: an empty Other types nothing into the pane, which would skip it.
 */
function paneAnswer(question: QuestionLike, response: string | string[] | undefined): QuestionAnswer | null {
	if (response === undefined || response === "" || response === NO_PREFERENCE_ANSWER) return null;
	const selected: number[] = [];
	let other: string | undefined;
	for (const element of Array.isArray(response) ? response : [response]) {
		const index = question.options.findIndex((option) => option.label === element);
		if (index >= 0) selected.push(index);
		else other = element;
	}
	const answer: QuestionAnswer = {selected: selected.toSorted((a, b) => a - b)};
	if (other !== undefined) answer.other = other;
	return answer;
}

/** Label responses, in question order, as the option picks `/api/herdr/question` types; for a reply with no picks. */
export function responsesToPaneAnswers(
	questions: readonly QuestionLike[],
	responses: readonly QuestionResponse[],
): Array<QuestionAnswer | null> {
	return questions.map((question, index) => paneAnswer(question, responses[index]?.response));
}

interface SubmissionTarget {
	sessionId: string;
	toolUseId: string;
	questions: readonly QuestionLike[];
}

/** A card's structured picks, or a typed reply's label responses. */
export type QuestionAnswerSubmission = SubmissionTarget &
	({picks: ReadonlyArray<QuestionAnswer | null>} | {responses: QuestionResponse[]});

/** Send a question card's answer along its route; the read-only route refuses. */
export async function submitQuestionAnswer(
	route: QuestionAnswerRoute,
	submission: QuestionAnswerSubmission,
): Promise<void> {
	const {sessionId, toolUseId, questions} = submission;
	switch (route) {
		case "live-pane":
			await sendHerdrQuestionAnswer(
				sessionId,
				toolUseId,
				"picks" in submission ? [...submission.picks] : responsesToPaneAnswers(questions, submission.responses),
			);
			return;
		case "fork":
			await postAnswerQuestion({
				sessionId,
				toolUseId,
				answers: "picks" in submission ? questionResponses(questions, submission.picks) : submission.responses,
			});
			return;
		case "read-only":
			throw new Error(READ_ONLY_ANSWER_HINT);
	}
}
