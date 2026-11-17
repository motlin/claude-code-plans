import {useQueryClient} from "@tanstack/react-query";
import {useCallback} from "react";

import
{
	sendHerdrRefusalFallbackChoice,
	type HerdrRefusalFallbackDialog,
	type RefusalFallbackChoice,
} from "../lib/api/herdr";
import {REFUSAL_FALLBACK_QUERY_KEY} from "../hooks/use-refusal-fallback-dialog";
import {focusComposer, refillComposer} from "../lib/context-attach";
import {RefusalFallbackPromptCard} from "./approval-card";

/**
 * Upstream's "Session paused" card docked above the composer for the CLI's
 * refusal-fallback dialog. A choice presses the CLI's key; after Edit, the
 * prompt the CLI put back in its input refills and focuses the browser
 * composer, as upstream's `Ax` does. Edit is always offered: the CLI owns it.
 */
export function RefusalFallbackDock({
	sessionId,
	dialog,
	fetcher = fetch,
}: {
	sessionId: string;
	dialog: HerdrRefusalFallbackDialog;
	fetcher?: typeof fetch;
})
{
	const queryClient = useQueryClient();
	const onChoose = useCallback(
		async (choice: RefusalFallbackChoice) =>
		{
			const text = await sendHerdrRefusalFallbackChoice(sessionId, choice, fetcher);
			if (choice === "edit_prompt" && text !== null)
			{
				refillComposer(sessionId, text);
				focusComposer(sessionId);
			}
			// The dialog has left the pane: read it again so the card leaves before the registry catches up.
			await queryClient.invalidateQueries(
				{
					queryKey: [REFUSAL_FALLBACK_QUERY_KEY, sessionId],
				},
			);
		},
		[sessionId, fetcher, queryClient],
	);
	return <RefusalFallbackPromptCard dialog={dialog} canEdit onChoose={onChoose} />;
}
