/**
 * Helpers for the AskUserQuestion tool flow used by the web viewer when
 * answering a pending prompt in an active session.
 */

export interface QuestionLike {
	question: string;
	header?: string;
	options: Array<{label: string; description?: string}>;
	multiSelect?: boolean;
}

export interface AnswerEntry {
	question: string;
	answer: string;
}

/**
 * Format an AskUserQuestion answer set into the user-prompt text that the
 * resumed Claude Code session will receive. The wording mirrors the format
 * Claude Code itself produces in the `tool_result` content when the user
 * answers via the TUI:
 *   "User has answered your questions: \"Q1\"=\"A1\". You can now continue..."
 *
 * Including the toolUseId in the message helps the resumed model correlate
 * the answer back to the still-pending tool call. Custom 'Other' entries are
 * passed through verbatim as the answer value.
 */
export function formatAnswerPrompt(toolUseId: string, answers: AnswerEntry[]): string {
	const pieces = answers.map((a) => `"${escapeQuote(a.question)}"="${escapeQuote(a.answer)}"`);
	return [
		`(Answering AskUserQuestion ${toolUseId} from the web viewer.)`,
		`User has answered your questions: ${pieces.join(', ')}.`,
		"You can now continue with the user's answers in mind.",
	].join(' ');
}

function escapeQuote(value: string): string {
	return value.replace(/"/g, '\\"');
}

/**
 * Normalize the polymorphic AskUserQuestion `tool_use.input` shape into a flat
 * array of questions. Supports both the multi-question form (`questions`) and
 * the older single-question form (`question` + `options`). Returns null when
 * neither form is present (e.g. malformed input).
 */
export function normalizeQuestions(input: Record<string, unknown>): QuestionLike[] | null {
	const multi = input['questions'];
	if (Array.isArray(multi) && multi.length > 0) {
		return multi as QuestionLike[];
	}
	const singleQ = typeof input['question'] === 'string' ? (input['question'] as string) : null;
	const singleOpts = input['options'] as Array<{label: string; description?: string}> | undefined;
	if (singleQ && singleOpts && singleOpts.length > 0) {
		const data: QuestionLike = {question: singleQ, options: singleOpts};
		if (typeof input['multiSelect'] === 'boolean') data.multiSelect = input['multiSelect'];
		if (typeof input['header'] === 'string') data.header = input['header'] as string;
		return [data];
	}
	return null;
}

export interface QuestionDraft {
	selected: Set<string>;
	otherText: string;
	useOther: boolean;
}

export function makeInitialDraft(): QuestionDraft {
	return {selected: new Set(), otherText: '', useOther: false};
}

/**
 * Project a draft into the final answer string for a question. Returns null
 * when no answer has been chosen (no selection, or 'Other' selected with empty
 * text). For multiSelect questions, joins selected labels with ', '.
 */
export function answerForQuestion(question: QuestionLike, draft: QuestionDraft): string | null {
	if (draft.useOther) {
		const trimmed = draft.otherText.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	const selected = [...draft.selected];
	if (selected.length === 0) return null;
	if (question.multiSelect) return selected.join(', ');
	return selected[0] ?? null;
}
