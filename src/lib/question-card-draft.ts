import type {QuestionLike} from "./ask-user-question";
import type {QuestionAnswer} from "./hook-events";

type QuestionShape = Pick<QuestionLike, "multiSelect">;

/** What the docked question card holds for one question while it is being answered. */
export interface QuestionCardDraft {
	selected: number[];
	other: string;
	otherChosen: boolean;
}

/** Pick a single-select option, or toggle a multi-select one. */
export function pickOption(question: QuestionShape, draft: QuestionCardDraft, option: number): QuestionCardDraft {
	if (question.multiSelect !== true) return {...draft, selected: [option], otherChosen: false};
	const selected = draft.selected.includes(option)
		? draft.selected.filter((index) => index !== option)
		: [...draft.selected, option];
	return {...draft, selected};
}

/** Choose Other: it replaces a single-select pick and toggles beside multi-select picks. */
export function chooseOther(question: QuestionShape, draft: QuestionCardDraft): QuestionCardDraft {
	if (question.multiSelect === true) return {...draft, otherChosen: !draft.otherChosen};
	return {...draft, selected: [], otherChosen: true};
}

/** Typing Other chooses it, as the CLI checks its "Type something" row on the first keystroke. */
export function typeOther(question: QuestionShape, draft: QuestionCardDraft, other: string): QuestionCardDraft {
	return {selected: question.multiSelect === true ? draft.selected : [], other, otherChosen: true};
}

/** Upstream's fork-route answer for a skipped question. */
export const NO_PREFERENCE_ANSWER = "[No preference]";

/** The answers as `/api/answer-question` takes them, as upstream builds them: any Other text first, then the picked labels. */
export function labelledAnswers(
	questions: readonly QuestionLike[],
	answers: ReadonlyArray<QuestionAnswer | null>,
): Array<{question: string; answer: string}> {
	return questions.map((question, index) => {
		const answer = answers[index];
		if (answer === null || answer === undefined) return {question: question.question, answer: NO_PREFERENCE_ANSWER};
		const labels = answer.selected.flatMap((option) => question.options[option]?.label ?? []);
		return {
			question: question.question,
			answer: [...(answer.other === undefined ? [] : [answer.other]), ...labels].join(", "),
		};
	});
}
