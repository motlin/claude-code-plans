import {z} from "zod";

import {mergeRefill} from "./send-rejection";

/** The composer's stored drafts in localStorage, one per draft key; `useComposerDraft` restores and debounces them. */
const COMPOSER_DRAFT_PREFIX = "ccp-composer-draft:";

/**
 * `failedSend` is upstream's local-session marker: the prompt herdr rejected, so a reload can show its card again.
 * `bashMode` is upstream's saved bash mode, so a restored draft comes back as a shell command.
 */
const ComposerDraftSchema = z.strictObject(
	{
		text: z.string(),
		failedSend: z.string().optional(),
		bashMode: z.literal(true).optional(),
	},
);

type StoredDraft = z.infer<typeof ComposerDraftSchema>;

/** `draftKey` is a session id, or `"home"` for the new-session composer. */
export function composerDraftStorageKey(draftKey: string): string
{
	return `${COMPOSER_DRAFT_PREFIX}${draftKey}`;
}

function browserLocalStorage(): Storage | null
{
	if (typeof window === "undefined") return null;
	try
	{
		return window.localStorage;
	}
	catch
	{
		return null;
	}
}

export function readStoredDraft(draftKey: string): StoredDraft | null
{
	try
	{
		const raw = browserLocalStorage()?.getItem(composerDraftStorageKey(draftKey));
		if (raw === null || raw === undefined) return null;
		const parsed = ComposerDraftSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	}
	catch
	{
		// Drafts are best-effort: storage can be denied or hold corrupt JSON.
		return null;
	}
}

export function storeDraft(draftKey: string, draft: StoredDraft): void
{
	try
	{
		const storage = browserLocalStorage();
		if (!storage) return;
		const key = composerDraftStorageKey(draftKey);
		if (draft.text.trim() === "") storage.removeItem(key);
		else storage.setItem(key, JSON.stringify(draft));
	}
	catch
	{
		// Drafts are best-effort: storage can be denied or full.
	}
}

/** Keeps the stored `failedSend` only while the text still equals it (upstream `T7` writes `failedSend:false` on an edit). */
export function writeDraft(draftKey: string, text: string, bashMode: boolean): void
{
	const failedSend = readStoredDraft(draftKey)?.failedSend;
	storeDraft(
		draftKey,
		{
			text,
			...(failedSend === text &&
			{
				failedSend,
			}),
			...(bashMode &&
			{
				bashMode: true,
			}),
		},
	);
}

/** Puts a prompt back in the stored draft while its composer is unmounted, so it comes back on the next mount. */
export function restoreStoredDraft(draftKey: string, text: string): void
{
	storeDraft(
		draftKey,
		{
			text,
		},
	);
}

/** Puts a rejected prompt above the stored draft while its composer is unmounted (upstream's off-screen `restoreDraftStash`). */
export function storeRejectedDraft(draftKey: string, text: string): void
{
	storeDraft(
		draftKey,
		{
			text: mergeRefill(text, readStoredDraft(draftKey)?.text ?? ""),
		},
	);
}

/**
 * Records a rejected prompt in the draft, so the send-rejected card comes back after a reload: merged above
 * newer stored text unless the draft already starts with it, and marked `failedSend` only while the draft
 * holds the prompt alone.
 */
export function markFailedSend(draftKey: string, prompt: string): void
{
	const stored = readStoredDraft(draftKey)?.text ?? "";
	const text = stored.startsWith(prompt) ? stored : mergeRefill(prompt, stored);
	storeDraft(
		draftKey,
		{
			text,
			...(text === prompt &&
			{
				failedSend: prompt,
			}),
		},
	);
}

/** The rejected prompt to show again, only while the stored draft text still equals it. */
export function readFailedSend(draftKey: string): string | null
{
	const draft = readStoredDraft(draftKey);
	return draft?.failedSend !== undefined && draft.failedSend === draft.text ? draft.failedSend : null;
}
