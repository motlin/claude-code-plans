import {useCallback, useEffect, useRef, useState} from "react";
import {z} from "zod";

/** Upstream writes on every input; we coalesce keystrokes but stay within one frame budget. */
export const COMPOSER_DRAFT_DEBOUNCE_MS = 150;

const COMPOSER_DRAFT_PREFIX = "ccp-composer-draft:";

/**
 * `failedSend` is upstream's local-session marker: the prompt herdr rejected, so a reload can show its card again.
 * `bashMode` is upstream's saved bash mode, so a restored draft comes back as a shell command.
 */
const ComposerDraftSchema = z.strictObject({
	text: z.string(),
	failedSend: z.string().optional(),
	bashMode: z.literal(true).optional(),
});

type StoredDraft = z.infer<typeof ComposerDraftSchema>;

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

function readStoredDraft(draftKey: string): StoredDraft | null {
	try {
		const raw = browserLocalStorage()?.getItem(composerDraftStorageKey(draftKey));
		if (raw === null || raw === undefined) return null;
		const parsed = ComposerDraftSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		// Drafts are best-effort: storage can be denied or hold corrupt JSON.
		return null;
	}
}

function storeDraft(draftKey: string, draft: StoredDraft): void {
	try {
		const storage = browserLocalStorage();
		if (!storage) return;
		const key = composerDraftStorageKey(draftKey);
		if (draft.text.trim() === "") storage.removeItem(key);
		else storage.setItem(key, JSON.stringify(draft));
	} catch {
		// Drafts are best-effort: storage can be denied or full.
	}
}

/** Keeps the stored `failedSend` only while the text still equals it (upstream `T7` writes `failedSend:false` on an edit). */
function writeDraft(draftKey: string, text: string, bashMode: boolean): void {
	const failedSend = readStoredDraft(draftKey)?.failedSend;
	storeDraft(draftKey, {
		text,
		...(failedSend === text && {failedSend}),
		...(bashMode && {bashMode: true}),
	});
}

/** Records a rejected prompt in the draft, so the send-rejected card comes back after a reload. */
export function markFailedSend(draftKey: string, prompt: string): void {
	storeDraft(draftKey, {text: prompt, failedSend: prompt});
}

/** The rejected prompt to show again, only while the stored draft text still equals it. */
export function readFailedSend(draftKey: string): string | null {
	const draft = readStoredDraft(draftKey);
	return draft?.failedSend !== undefined && draft.failedSend === draft.text ? draft.failedSend : null;
}

export interface ComposerDraft {
	text: string;
	setText: (text: string) => void;
	/** Upstream's bash mode, saved with the draft. */
	bashMode: boolean;
	setBashMode: (bashMode: boolean) => void;
	/** Empties the composer, leaves bash mode, and drops the stored draft immediately (e.g. after a send). */
	clear: () => void;
}

/**
 * The composer's text, persisted per session in localStorage so an unsent prompt
 * survives navigation. Restored after mount so SSR and hydration render empty.
 */
export function useComposerDraft(draftKey: string): ComposerDraft {
	const [text, setTextState] = useState("");
	// Keyed by draft, so a draft switch never shows the previous draft's mode before the restore lands.
	const [bash, setBash] = useState<{key: string; on: boolean} | null>(null);
	const latest = useRef({text: "", bashMode: false});
	const pending = useRef<{
		key: string;
		text: string;
		bashMode: boolean;
		timer: ReturnType<typeof setTimeout>;
	} | null>(null);

	const flush = useCallback(() => {
		const current = pending.current;
		if (!current) return;
		clearTimeout(current.timer);
		pending.current = null;
		writeDraft(current.key, current.text, current.bashMode);
	}, []);

	useEffect(() => {
		const stored = readStoredDraft(draftKey);
		latest.current = {text: stored?.text ?? "", bashMode: stored?.bashMode === true};
		setTextState(latest.current.text);
		setBash({key: draftKey, on: latest.current.bashMode});
		return flush;
	}, [draftKey, flush]);

	const schedule = useCallback(() => {
		if (pending.current) clearTimeout(pending.current.timer);
		pending.current = {
			key: draftKey,
			...latest.current,
			timer: setTimeout(flush, COMPOSER_DRAFT_DEBOUNCE_MS),
		};
	}, [draftKey, flush]);

	const setText = useCallback(
		(next: string) => {
			latest.current = {...latest.current, text: next};
			setTextState(next);
			schedule();
		},
		[schedule],
	);

	const setBashMode = useCallback(
		(on: boolean) => {
			latest.current = {...latest.current, bashMode: on};
			setBash({key: draftKey, on});
			schedule();
		},
		[draftKey, schedule],
	);

	const clear = useCallback(() => {
		if (pending.current) clearTimeout(pending.current.timer);
		pending.current = null;
		latest.current = {text: "", bashMode: false};
		setTextState("");
		setBash({key: draftKey, on: false});
		writeDraft(draftKey, "", false);
	}, [draftKey]);

	const bashMode = bash?.key === draftKey && bash.on;
	return {text, setText, bashMode, setBashMode, clear};
}
