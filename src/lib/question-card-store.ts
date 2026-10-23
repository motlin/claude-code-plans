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

/**
 * Upstream's in-memory sent store: the answers and page a card submitted, kept
 * until the call's result lands (or the send fails) so a card that remounts
 * while sending redraws them busy instead of as a fresh editable card.
 */
const sent = new Map<string, QuestionCardState>();

export function markQuestionCardSent(key: string, state: QuestionCardState): void {
	sent.set(key, state);
}

/** The submitted state for a card of `questionCount` questions, or null when none is sending. */
export function readSentQuestionCard(key: string, questionCount: number): QuestionCardState | null {
	const state = sent.get(key);
	if (state === undefined || state.drafts.length !== questionCount || state.skipped.length !== questionCount)
		return null;
	return state;
}

/** Called with the failure message when the send failed, or null when its result landed. */
type SentListener = (error: string | null) => void;

const sentListeners = new Map<string, Set<SentListener>>();

/** Upstream's sent-store subscription: hear when the card's sending entry is dropped. */
export function subscribeSentQuestionCard(key: string, listener: SentListener): () => void {
	const listeners = sentListeners.get(key) ?? new Set<SentListener>();
	sentListeners.set(key, listeners);
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) sentListeners.delete(key);
	};
}

/** Drops the sending entry and notifies subscribers, with `error` when the send failed. */
export function clearSentQuestionCard(key: string, error: string | null = null): void {
	if (!sent.delete(key)) return;
	for (const listener of [...(sentListeners.get(key) ?? [])]) listener(error);
}

/**
 * Upstream's in-memory seen map: draft keys of cards that have intersected the
 * viewport in this page, so a card that remounts skips its enter fade.
 */
const seen = new Set<string>();

export function markQuestionCardSeen(key: string): void {
	seen.add(key);
}

export function wasQuestionCardSeen(key: string): boolean {
	return seen.has(key);
}
