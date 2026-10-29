import {useQuery} from "@tanstack/react-query";
import {useCallback} from "react";

import {fetchHerdrElicitationDialog, sendHerdrElicitationDecision} from "../lib/api/herdr";
import type {UrlElicitationCardModel} from "../lib/permission-card";
import {UrlElicitationCard} from "./approval-card";

/**
 * The session's url elicitation, docked above the composer: reads the CLI's
 * dialog off the pane so Open is on only when the dialog sits on Accept, and
 * answers through `/api/herdr/elicitation` as kind "url".
 */
export function UrlElicitationDock({
	sessionId,
	card,
	fetcher = fetch,
}: {
	sessionId: string;
	card: UrlElicitationCardModel;
	fetcher?: typeof fetch;
}) {
	const dialog = useQuery({
		queryKey: ["herdr-elicitation-dialog", sessionId, card.key] as const,
		queryFn: async () => fetchHerdrElicitationDialog(sessionId, fetcher),
		retry: false,
	});
	const dialogFocus = dialog.isPending ? undefined : dialog.data?.kind === "url" ? dialog.data.focus : null;
	const onDecision = useCallback(
		async (decision: "allow" | "deny") => sendHerdrElicitationDecision(sessionId, decision, fetcher, "url"),
		[sessionId, fetcher],
	);
	return (
		<UrlElicitationCard
			serverName={card.serverName}
			message={card.message}
			url={card.url}
			dialogFocus={dialogFocus}
			onDecision={onDecision}
		/>
	);
}
