import {useQuery} from "@tanstack/react-query";

import {fetchHerdrRefusalFallbackDialog, type HerdrRefusalFallbackDialog} from "../lib/api/herdr";

export const REFUSAL_FALLBACK_QUERY_KEY = "herdr-refusal-fallback";

/**
 * The CLI's refusal-fallback dialog read off the session's pane, while its
 * registry reports a dialog open (`dialogOpenAt`, null otherwise) and the pane
 * can be typed into. Each new dialog (a new `dialogOpenAt`) reads again. Null
 * while reading, when the pane shows some other dialog, or on a failed read.
 */
export function useRefusalFallbackDialog(
	sessionId: string,
	dialogOpenAt: number | null,
	fetcher: typeof fetch = fetch,
): HerdrRefusalFallbackDialog | null
{
	const dialog = useQuery(
		{
			queryKey: [REFUSAL_FALLBACK_QUERY_KEY, sessionId, dialogOpenAt] as const,
			queryFn: async () => fetchHerdrRefusalFallbackDialog(sessionId, fetcher),
			enabled: dialogOpenAt !== null,
			retry: false,
		},
	);
	return dialogOpenAt === null ? null : (dialog.data ?? null);
}
