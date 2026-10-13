import {normalizeQuestions} from "./ask-user-question";
import {hmrPersist} from "./hmr-persist";
import type {PendingQuestion, PendingQuestionItem} from "./hook-events";
import {toolInputSchemas} from "./tool-input-schemas";

/**
 * The AskUserQuestion call each session waits on, keyed by session id. Lives
 * only in memory: a restarted server forgets it and the dock falls back to the
 * generic waiting notice until the next question.
 */
const store = hmrPersist("pendingQuestionStore", () => new Map<string, PendingQuestion>());

/** Trim a hook's AskUserQuestion input to the fields the card shows, or null when it asks nothing. */
export function pendingQuestionFromToolInput(toolUseId: string, toolInput: unknown): PendingQuestion | null {
	const input = toolInputSchemas.AskUserQuestion.safeParse(toolInput);
	if (!input.success) return null;
	const questions = normalizeQuestions(input.data);
	if (questions === null) return null;
	return {
		toolUseId,
		questions: questions.map((source) => {
			const item: PendingQuestionItem = {
				question: source.question,
				options: source.options.map((option) =>
					option.description === undefined
						? {label: option.label}
						: {label: option.label, description: option.description},
				),
			};
			if (source.header !== undefined) item.header = source.header;
			if (source.multiSelect !== undefined) item.multiSelect = source.multiSelect;
			return item;
		}),
	};
}

export function setPendingQuestion(sessionId: string, pending: PendingQuestion): void {
	store.set(sessionId, pending);
}

/** Forget the session's pending question; true when there was one. */
export function clearPendingQuestion(sessionId: string): boolean {
	return store.delete(sessionId);
}

export function getPendingQuestion(sessionId: string): PendingQuestion | null {
	return store.get(sessionId) ?? null;
}

export function clearAllPendingQuestions(): void {
	store.clear();
}
