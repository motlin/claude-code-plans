import {normalizeQuestions} from "./ask-user-question";
import {PendingQuestionSchema, type PendingQuestion, type PendingQuestionItem} from "./hook-events";
import {persistedSessionMap} from "./persisted-session-map";
import {toolInputSchemas} from "./tool-input-schemas";

/**
 * The AskUserQuestion call each session waits on, keyed by session id. The
 * server mirrors it to a JSON file, so a question asked before a restart still
 * docks after it; the CLI writes it nowhere else until it is answered.
 */
const store = persistedSessionMap<PendingQuestion>("pendingQuestion", PendingQuestionSchema);

/** Mirror the store to `file` from now on, first replacing it with what the file holds. */
export function persistPendingQuestionsTo(file: string): void {
	store.persistTo(file);
}

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
	return store.get(sessionId);
}

/** Forget every pending question in memory and stop mirroring to disk, as a fresh process starts. */
export function clearAllPendingQuestions(): void {
	store.reset();
}
