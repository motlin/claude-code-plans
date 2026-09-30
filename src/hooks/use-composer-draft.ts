import {useCallback, useEffect, useRef, useState} from "react";
import {z} from "zod";

/** Upstream writes on every input; we coalesce keystrokes but stay within one frame budget. */
export const COMPOSER_DRAFT_DEBOUNCE_MS = 150;

const COMPOSER_DRAFT_PREFIX = "ccp-composer-draft:";

const ComposerDraftSchema = z.strictObject({text: z.string()});

/** `draftKey` is a session id, or `"home"` for the new-session composer. */
export function composerDraftStorageKey(draftKey: string): string {
	return `${COMPOSER_DRAFT_PREFIX}${draftKey}`;
}

function browserLocalStorage(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function readDraft(draftKey: string): string {
	try {
		const raw = browserLocalStorage()?.getItem(composerDraftStorageKey(draftKey));
		if (raw === null || raw === undefined) return "";
		const parsed = ComposerDraftSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data.text : "";
	} catch {
		// Drafts are best-effort: storage can be denied or hold corrupt JSON.
		return "";
	}
}

function writeDraft(draftKey: string, text: string): void {
	try {
		const storage = browserLocalStorage();
		if (!storage) return;
		const key = composerDraftStorageKey(draftKey);
		if (text.trim() === "") storage.removeItem(key);
		else storage.setItem(key, JSON.stringify({text}));
	} catch {
		// Drafts are best-effort: storage can be denied or full.
	}
}

export interface ComposerDraft {
	text: string;
	setText: (text: string) => void;
	/** Empties the composer and drops the stored draft immediately (e.g. after a send). */
	clear: () => void;
}

/**
 * The composer's text, persisted per session in localStorage so an unsent prompt
 * survives navigation. Restored after mount so SSR and hydration render empty.
 */
export function useComposerDraft(draftKey: string): ComposerDraft {
	const [text, setTextState] = useState("");
	const pending = useRef<{
		key: string;
		text: string;
		timer: ReturnType<typeof setTimeout>;
	} | null>(null);

	const flush = useCallback(() => {
		const current = pending.current;
		if (!current) return;
		clearTimeout(current.timer);
		pending.current = null;
		writeDraft(current.key, current.text);
	}, []);

	useEffect(() => {
		setTextState(readDraft(draftKey));
		return flush;
	}, [draftKey, flush]);

	const setText = useCallback(
		(next: string) => {
			setTextState(next);
			if (pending.current) clearTimeout(pending.current.timer);
			pending.current = {
				key: draftKey,
				text: next,
				timer: setTimeout(flush, COMPOSER_DRAFT_DEBOUNCE_MS),
			};
		},
		[draftKey, flush],
	);

	const clear = useCallback(() => {
		if (pending.current) clearTimeout(pending.current.timer);
		pending.current = null;
		setTextState("");
		writeDraft(draftKey, "");
	}, [draftKey]);

	return {text, setText, clear};
}
