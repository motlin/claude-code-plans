import {useEffect, useState} from "react";

import {apiFetch} from "../lib/api/client";
import {fileMentionsUrl, type SessionFilesEntry, SessionFilesResponseSchema} from "../lib/api/session-files";
import {FILE_MENTION_CAP, FILE_MENTION_DEBOUNCE_MS} from "../lib/file-mentions";

export interface FileMentionSuggestions {
	/** The mention query these entries answer. */
	query: string;
	entries: SessionFilesEntry[];
}

/**
 * Debounced "@" suggestions for the session's working directory: the
 * top-level listing for an empty query, else a fuzzy search, capped at 15.
 * The last answered query stays visible while the next one is in flight.
 */
export function useFileMentionSuggestions(
	sessionId: string | undefined,
	query: string | null,
): FileMentionSuggestions | null {
	const [suggestions, setSuggestions] = useState<FileMentionSuggestions | null>(null);

	useEffect(() => {
		if (sessionId === undefined || query === null) return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			apiFetch(fileMentionsUrl(sessionId, query), SessionFilesResponseSchema, {
				signal: controller.signal,
			}).then(
				(response) => {
					const entries =
						response.kind === "listing"
							? response.entries
							: response.kind === "search"
								? response.results
								: [];
					setSuggestions({query, entries: entries.slice(0, FILE_MENTION_CAP)});
				},
				() => {
					if (!controller.signal.aborted) setSuggestions({query, entries: []});
				},
			);
		}, FILE_MENTION_DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [sessionId, query]);

	return sessionId === undefined || query === null ? null : suggestions;
}
