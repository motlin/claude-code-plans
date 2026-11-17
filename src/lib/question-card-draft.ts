import type {QuestionLike} from "./ask-user-question";
import type {QuestionAnswer} from "./hook-events";

type QuestionShape = Pick<QuestionLike, "multiSelect">;

/** What the docked question card holds for one question while it is being answered. */
export interface QuestionCardDraft
{
	selected: number[];
	other: string;
	otherChosen: boolean;
}

/** Pick a single-select option, or toggle a multi-select one. */
export function pickOption(question: QuestionShape, draft: QuestionCardDraft, option: number): QuestionCardDraft
{
	if (question.multiSelect !== true)
		return {
			...draft,
			selected: [option],
			otherChosen: false,
		};
	const selected = draft.selected.includes(option)
		? draft.selected.filter((index) => index !== option)
		: [...draft.selected, option];
	return {
		...draft,
		selected,
	};
}

/** Choose Other: it replaces a single-select pick and toggles beside multi-select picks. */
export function chooseOther(question: QuestionShape, draft: QuestionCardDraft): QuestionCardDraft
{
	if (question.multiSelect === true)
		return {
			...draft,
			otherChosen: !draft.otherChosen,
		};
	return {
		...draft,
		selected: [],
		otherChosen: true,
	};
}

/** Upstream's `rD`: a question whose options carry a preview, which the docked card selects instead of answering. */
export function hasPreviews(question: QuestionLike): boolean
{
	return question.multiSelect !== true && question.options.some((option) => option.preview !== undefined);
}

/**
 * Upstream's docked `handleOptionClick` (Rh7), with -1 for Other: a multi-select toggles; Other or a previewed
 * question selects; a plain single-select records its answer at once (`answerNow`). The click highlights its row.
 */
export function pickDockedOption(
	question: QuestionLike,
	draft: QuestionCardDraft,
	option: number,
):
{
	draft: QuestionCardDraft;
	highlighted: number;
	answerNow: boolean;
}
{
	if (option === -1)
		return {
			draft: chooseOther(question, draft),
			highlighted: -1,
			answerNow: false,
		};
	return {
		draft: pickOption(question, draft, option),
		highlighted: option,
		answerNow: question.multiSelect !== true && !hasPreviews(question),
	};
}

/** Typing Other chooses it, as the CLI checks its "Type something" row on the first keystroke. */
export function typeOther(question: QuestionShape, draft: QuestionCardDraft, other: string): QuestionCardDraft
{
	return {
		selected: question.multiSelect === true ? draft.selected : [],
		other,
		otherChosen: true,
	};
}

/** Upstream's fork-route answer for a skipped question. */
export const NO_PREFERENCE_ANSWER = "[No preference]";

/** Upstream sends an Other picked with nothing typed as this. */
export const EMPTY_OTHER = "Something else";

/** One question's answer as upstream's `bt` builds it: the label, or every label for a multi-select, and a picked preview. */
export interface QuestionResponse
{
	question: string;
	response: string | string[];
	preview?: string;
}

/**
 * Upstream's `bt`: each question's Other text (`Something else` when blank) first, then its picked labels in option
 * order, as an array for a multi-select and the first label otherwise; a single-select's first pick carries its
 * `preview`. A skip answers `[No preference]`.
 */
export function questionResponses(
	questions: readonly QuestionLike[],
	answers: ReadonlyArray<QuestionAnswer | null>,
): QuestionResponse[]
{
	return questions.map((question, index) =>
	{
		const answer = answers[index];
		if (answer === null || answer === undefined)
			return {
				question: question.question,
				response: NO_PREFERENCE_ANSWER,
			};
		const picked = answer.selected.toSorted((a, b) => a - b);
		const other = answer.other === undefined ? [] : [answer.other.trim() || EMPTY_OTHER];
		const labels = [...other, ...picked.flatMap((option) => question.options[option]?.label ?? [])];
		if (question.multiSelect === true)
			return {
				question: question.question,
				response: labels,
			};
		const entry: QuestionResponse =
		{
			question: question.question,
			response: labels[0] ?? NO_PREFERENCE_ANSWER,
		};
		const preview = answer.other === undefined ? question.options[picked[0] ?? -1]?.preview : undefined;
		if (typeof preview === "string") entry.preview = preview;
		return entry;
	});
}

/** The answers as one line each, multi-select labels joined with `", "` as the CLI stores them. */
export function labelledAnswers(
	questions: readonly QuestionLike[],
	answers: ReadonlyArray<QuestionAnswer | null>,
): Array<
{
	question: string;
	answer: string;
}>
{
	return questionResponses(questions, answers).map(({question, response}) => (
	{
		question,
		answer: Array.isArray(response) ? response.join(", ") : response,
	}));
}
