import {useCallback, useSyncExternalStore} from "react";
import {z} from "zod";

import {isApprovalAnswered} from "./answered-approvals";

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
 * while sending redraws their receipt instead of a fresh editable card. A live
 * answer is also kept in sessionStorage with its session, so a reload after the
 * answer was acknowledged (delivered) redraws the receipt too.
 */
const sent = new Map<string, QuestionCardState>();

const SENT_STORAGE_PREFIX = "question-card-sent:";

const StoredSentSchema = z.strictObject({sessionId: z.string(), state: QuestionCardStateSchema});

function writeStoredSent(key: string, sessionId: string, state: QuestionCardState): void {
	try {
		browserSessionStorage()?.setItem(SENT_STORAGE_PREFIX + key, JSON.stringify({sessionId, state}));
	} catch {
		// Quota or denied storage: a reload just loses the receipt, as upstream's does.
	}
}

function removeStoredSent(key: string): void {
	try {
		browserSessionStorage()?.removeItem(SENT_STORAGE_PREFIX + key);
	} catch {
		// Denied storage holds nothing to clear.
	}
}

/** Keys whose stored sent state was already looked up: a reload's restore happens once per key. */
const storedSentChecked = new Set<string>();

/** The card's sent state: this page's, else a stored one whose answer was acknowledged before a reload. */
function sentState(key: string): QuestionCardState | undefined {
	const live = sent.get(key);
	if (live !== undefined || storedSentChecked.has(key)) return live;
	storedSentChecked.add(key);
	try {
		const raw = browserSessionStorage()?.getItem(SENT_STORAGE_PREFIX + key) ?? null;
		if (raw === null) return undefined;
		const parsed = StoredSentSchema.safeParse(JSON.parse(raw));
		if (!parsed.success || !isApprovalAnswered(parsed.data.sessionId, key)) return undefined;
		sent.set(key, parsed.data.state);
		return parsed.data.state;
	} catch {
		return undefined;
	}
}

/** Hears every add to or drop from the sent map, for `useQuestionCardSent`. */
const sentChangeListeners = new Set<() => void>();

function notifySentChange(): void {
	for (const listener of [...sentChangeListeners]) listener();
}

function subscribeSentChange(listener: () => void): () => void {
	sentChangeListeners.add(listener);
	return () => {
		sentChangeListeners.delete(listener);
	};
}

/** With `sessionId` (a live answer) the sent state also survives a reload once acknowledged. */
export function markQuestionCardSent(key: string, state: QuestionCardState, sessionId?: string): void {
	const added = !sent.has(key);
	sent.set(key, state);
	if (sessionId !== undefined) writeStoredSent(key, sessionId, state);
	if (added) notifySentChange();
}

/** The submitted state for a card of `questionCount` questions, or null when none is sending. */
export function readSentQuestionCard(key: string, questionCount: number): QuestionCardState | null {
	const state = sentState(key);
	if (state === undefined || state.drafts.length !== questionCount || state.skipped.length !== questionCount)
		return null;
	return state;
}

/** Whether the card under `key` has an answer sending, whatever its shape. */
export function isQuestionCardSent(key: string): boolean {
	return sentState(key) !== undefined;
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
	removeStoredSent(key);
	if (!sent.delete(key)) return;
	notifySentChange();
	for (const listener of [...(sentListeners.get(key) ?? [])]) listener(error);
}

/** Whether the card under `key` has an answer sending, re-rendering as that changes. */
export function useQuestionCardSent(key: string): boolean {
	const getSnapshot = useCallback(() => sentState(key) !== undefined, [key]);
	return useSyncExternalStore(subscribeSentChange, getSnapshot, () => false);
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

/** Drops every draft, sent answer and seen card with their stored copies, as a fresh page starts; tests call it between cases. */
export function resetQuestionCardStore(): void {
	memory.clear();
	sent.clear();
	storedSentChecked.clear();
	seen.clear();
	try {
		const storage = browserSessionStorage();
		if (storage !== null) {
			const keys = Array.from({length: storage.length}, (_, index) => storage.key(index));
			for (const key of keys) {
				if (key?.startsWith(STORAGE_PREFIX) === true || key?.startsWith(SENT_STORAGE_PREFIX) === true)
					storage.removeItem(key);
			}
		}
	} catch {
		// Denied storage holds nothing to clear.
	}
	notifySentChange();
}
