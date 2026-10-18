import {z} from "zod";

/**
 * Upstream's per-tool question card draft store: the picks, Other text, skips
 * and page of a card being answered, kept in a module map and in sessionStorage
 * under the card's draft key so a remount or reload restores them.
 */
const STORAGE_PREFIX = "question-card-draft:";

const QuestionCardStateSchema = z.strictObject({
	page: z.number().int().nonnegative(),
	drafts: z.array(
		z.strictObject({
			selected: z.array(z.number().int().nonnegative()),
			other: z.string(),
			otherChosen: z.boolean(),
		}),
	),
	skipped: z.array(z.boolean()),
});

export type QuestionCardState = z.infer<typeof QuestionCardStateSchema>;

const memory = new Map<string, QuestionCardState>();

function browserSessionStorage(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function readStored(key: string): QuestionCardState | null {
	try {
		const raw = browserSessionStorage()?.getItem(STORAGE_PREFIX + key) ?? null;
		if (raw === null) return null;
		const parsed = QuestionCardStateSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		// sessionStorage can be denied or hold corrupt JSON; drafts are best-effort.
		return null;
	}
}

/** The saved state for a card of `questionCount` questions, or null when none fits. */
export function readQuestionCardState(key: string, questionCount: number): QuestionCardState | null {
	const state = memory.get(key) ?? readStored(key);
	if (state === null || state.drafts.length !== questionCount || state.skipped.length !== questionCount) return null;
	return {...state, page: Math.min(state.page, questionCount - 1)};
}

export function writeQuestionCardState(key: string, state: QuestionCardState): void {
	memory.set(key, state);
	try {
		browserSessionStorage()?.setItem(STORAGE_PREFIX + key, JSON.stringify(state));
	} catch {
		// Quota or denied storage: the in-memory copy still covers remounts.
	}
}

export function clearQuestionCardState(key: string): void {
	memory.delete(key);
	try {
		browserSessionStorage()?.removeItem(STORAGE_PREFIX + key);
	} catch {
		// Denied storage holds nothing to clear.
	}
}
