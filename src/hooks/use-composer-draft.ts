import {useCallback, useEffect, useRef, useState} from "react";

import {readStoredDraft, storeDraft, writeDraft} from "../lib/composer-draft-store";
import {SAVED_DRAFT_DEMOTE_CHARS, stageSavedDraft} from "../lib/context-attach";

/** Upstream writes on every input; we coalesce keystrokes but stay within one frame budget. */
export const COMPOSER_DRAFT_DEBOUNCE_MS = 150;

export interface ComposerDraft
{
	text: string;
	setText: (text: string) => void;
	/** Upstream's bash mode, saved with the draft. */
	bashMode: boolean;
	setBashMode: (bashMode: boolean) => void;
	/** Empties the composer, leaves bash mode, and drops the stored draft immediately (e.g. after a send). */
	clear: () => void;
	/** The draft key `text` belongs to: it lags a key switch until the restore lands; null before the first. */
	textKey: string | null;
}

/**
 * The composer's text, persisted per session in localStorage so an unsent prompt
 * survives navigation. Restored after mount so SSR and hydration render empty.
 */
export function useComposerDraft(draftKey: string): ComposerDraft
{
	const [text, setTextState] = useState("");
	// Keyed by draft, so a draft switch never shows the previous draft's mode before the restore lands.
	const [bash, setBash] = useState<
	{
		key: string;
		on: boolean;
	} | null>(null);
	const latest = useRef(
		{
			text: "",
			bashMode: false,
		},
	);
	const pending = useRef<
	{
		key: string;
		text: string;
		bashMode: boolean;
		timer: ReturnType<typeof setTimeout>;
	} | null>(null);

	const flush = useCallback(() =>
	{
		const current = pending.current;
		if (!current) return;
		clearTimeout(current.timer);
		pending.current = null;
		writeDraft(current.key, current.text, current.bashMode);
	}, []);

	useEffect(() =>
	{
		const stored = readStoredDraft(draftKey);
		// Upstream `mP`: only a restore demotes; text typed past the limit stays inline.
		const demote = stored !== null && stored.text.length > SAVED_DRAFT_DEMOTE_CHARS;
		if (demote)
		{
			stageSavedDraft(draftKey, stored.text);
			storeDraft(
				draftKey,
				{
					text: "",
				},
			);
		}
		latest.current =
		{
			text: demote ? "" : (stored?.text ?? ""),
			bashMode: !demote && stored?.bashMode === true,
		};
		setTextState(latest.current.text);
		setBash(
			{
				key: draftKey,
				on: latest.current.bashMode,
			},
		);
		return flush;
	}, [draftKey, flush]);

	const schedule = useCallback(() =>
	{
		if (pending.current) clearTimeout(pending.current.timer);
		pending.current =
		{
			key: draftKey,
			...latest.current,
			timer: setTimeout(flush, COMPOSER_DRAFT_DEBOUNCE_MS),
		};
	}, [draftKey, flush]);

	const setText = useCallback(
		(next: string) =>
		{
			latest.current =
			{
				...latest.current,
				text: next,
			};
			setTextState(next);
			schedule();
		},
		[schedule],
	);

	const setBashMode = useCallback(
		(on: boolean) =>
		{
			latest.current =
			{
				...latest.current,
				bashMode: on,
			};
			setBash(
				{
					key: draftKey,
					on,
				},
			);
			schedule();
		},
		[draftKey, schedule],
	);

	const clear = useCallback(() =>
	{
		if (pending.current) clearTimeout(pending.current.timer);
		pending.current = null;
		latest.current =
		{
			text: "",
			bashMode: false,
		};
		setTextState("");
		setBash(
			{
				key: draftKey,
				on: false,
			},
		);
		writeDraft(draftKey, "", false);
	}, [draftKey]);

	const bashMode = bash?.key === draftKey && bash.on;
	return {
		text,
		setText,
		bashMode,
		setBashMode,
		clear,
		textKey: bash?.key ?? null,
	};
}
