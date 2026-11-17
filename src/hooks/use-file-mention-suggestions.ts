import {useEffect, useMemo, useState} from "react";

import {apiFetch} from "../lib/api/client";
import
{
	fileMentionsUrl,
	folderMentionsUrl,
	type SessionFilesEntry,
	SessionFilesResponseSchema,
} from "../lib/api/session-files";
import {FILE_MENTION_CAP, FILE_MENTION_DEBOUNCE_MS, HIDDEN_MENTION_NAMES} from "../lib/file-mentions";
import {type MentionOutputFile, mergeMentionOutputs} from "../lib/session-outputs";

export interface FileMentionSuggestions
{
	/** The mention query these entries answer. */
	query: string;
	entries: SessionFilesEntry[];
}

/** Where "@" looks for files: a session's working directory, or (on the home draft) the chosen project folder. */
export type FileMentionSource =
	|
	  {
			sessionId: string;
	  }
	|
	  {
			folder: string;
	  };

const NO_OUTPUTS: readonly MentionOutputFile[] = [];

/**
 * Debounced "@" suggestions for the source's directory: the
 * top-level listing for an empty query, else a fuzzy search, minus VCS/OS
 * junk entries, capped at 15. A search also ranks in the session's matching `outputs` (upstream `ys`).
 * The last answered query stays visible while the next one is in flight.
 */
export function useFileMentionSuggestions(
	source: FileMentionSource | undefined,
	query: string | null,
	outputs: readonly MentionOutputFile[] = NO_OUTPUTS,
): FileMentionSuggestions | null
{
	const [suggestions, setSuggestions] = useState<FileMentionSuggestions | null>(null);
	// Keyed on the built URL's prefix, not the source object, so a re-render doesn't restart the debounce.
	const sessionId = source !== undefined && "sessionId" in source ? source.sessionId : undefined;
	const folder = source !== undefined && "folder" in source ? source.folder : undefined;
	const active = sessionId !== undefined || folder !== undefined;

	useEffect(() =>
	{
		if (query === null) return undefined;
		const url =
			sessionId === undefined
				? folder === undefined
					? undefined
					: folderMentionsUrl(folder, query)
				: fileMentionsUrl(sessionId, query);
		if (url === undefined) return undefined;
		const controller = new AbortController();
		const timer = setTimeout(() =>
		{
			apiFetch(
				url,
				SessionFilesResponseSchema,
				{
					signal: controller.signal,
				},
			).then(
				(response) =>
				{
					const entries =
						response.kind === "listing"
							? response.entries
							: response.kind === "search"
								? response.results
								: [];
					setSuggestions(
						{
							query,
							entries: entries
								.filter((entry) => !HIDDEN_MENTION_NAMES.has(entry.name))
								.slice(0, FILE_MENTION_CAP),
						},
					);
				},
				() =>
				{
					if (!controller.signal.aborted)
						setSuggestions(
							{
								query,
								entries: [],
							},
						);
				},
			);
		}, FILE_MENTION_DEBOUNCE_MS);
		return () =>
		{
			clearTimeout(timer);
			controller.abort();
		};
	}, [sessionId, folder, query]);

	const merged = useMemo(
		() =>
			suggestions === null
				? null
				:
					{
						query: suggestions.query,
						entries: mergeMentionOutputs(suggestions.query, suggestions.entries, outputs, FILE_MENTION_CAP),
					},
		[suggestions, outputs],
	);
	return !active || query === null ? null : merged;
}
