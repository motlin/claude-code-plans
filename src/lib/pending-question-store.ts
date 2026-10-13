import {readFileSync, renameSync, writeFileSync} from "node:fs";
import {z} from "zod";
import {normalizeQuestions} from "./ask-user-question";
import {hmrPersist} from "./hmr-persist";
import {PendingQuestionSchema, type PendingQuestion, type PendingQuestionItem} from "./hook-events";
import {toolInputSchemas} from "./tool-input-schemas";

/**
 * The AskUserQuestion call each session waits on, keyed by session id. The
 * server mirrors it to a JSON file, so a question asked before a restart still
 * docks after it; the CLI writes it nowhere else until it is answered.
 */
const store = hmrPersist("pendingQuestionStore", () => new Map<string, PendingQuestion>());
const persistence = hmrPersist("pendingQuestionFile", () => ({file: null as string | null}));

const PendingQuestionFileSchema = z.record(z.string(), PendingQuestionSchema);

/** Mirror the store to `file` from now on, first replacing it with what the file holds. */
export function persistPendingQuestionsTo(file: string): void {
	persistence.file = file;
	store.clear();
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return;
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return;
	}
	const saved = PendingQuestionFileSchema.safeParse(json);
	if (!saved.success) return;
	for (const [sessionId, pending] of Object.entries(saved.data)) store.set(sessionId, pending);
}

function save(): void {
	const {file} = persistence;
	if (file === null) return;
	const temp = `${file}.tmp`;
	writeFileSync(temp, JSON.stringify(Object.fromEntries(store)));
	renameSync(temp, file);
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
	save();
}

/** Forget the session's pending question; true when there was one. */
export function clearPendingQuestion(sessionId: string): boolean {
	const cleared = store.delete(sessionId);
	if (cleared) save();
	return cleared;
}

export function getPendingQuestion(sessionId: string): PendingQuestion | null {
	return store.get(sessionId) ?? null;
}

/** Forget every pending question in memory and stop mirroring to disk, as a fresh process starts. */
export function clearAllPendingQuestions(): void {
	store.clear();
	persistence.file = null;
}
