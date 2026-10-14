import type {PendingQuestionItem, QuestionAnswer} from "./hook-events";

/** What the docked question card holds for one question while it is being answered. */
export interface QuestionCardDraft {
	selected: number[];
	other: string;
	otherChosen: boolean;
}

export const EMPTY_QUESTION_DRAFT: QuestionCardDraft = {selected: [], other: "", otherChosen: false};

/** Pick a single-select option, or toggle a multi-select one. */
export function pickOption(question: PendingQuestionItem, draft: QuestionCardDraft, option: number): QuestionCardDraft {
	if (question.multiSelect !== true) return {...draft, selected: [option], otherChosen: false};
	const selected = draft.selected.includes(option)
		? draft.selected.filter((index) => index !== option)
		: [...draft.selected, option];
	return {...draft, selected};
}

/** Choose Other: it replaces a single-select pick and toggles beside multi-select picks. */
export function chooseOther(question: PendingQuestionItem, draft: QuestionCardDraft): QuestionCardDraft {
	if (question.multiSelect === true) return {...draft, otherChosen: !draft.otherChosen};
	return {...draft, selected: [], otherChosen: true};
}

/** Typing Other chooses it, as the CLI checks its "Type something" row on the first keystroke. */
export function typeOther(question: PendingQuestionItem, draft: QuestionCardDraft, other: string): QuestionCardDraft {
	return {selected: question.multiSelect === true ? draft.selected : [], other, otherChosen: true};
}

/** The draft as the answer `/api/herdr/question` takes, or null while it answers nothing. */
export function draftAnswer(draft: QuestionCardDraft): QuestionAnswer | null {
	const other = draft.otherChosen ? draft.other.trim() : "";
	const selected = draft.selected.toSorted((a, b) => a - b);
	if (other === "") return selected.length === 0 ? null : {selected};
	return {selected, other};
}
