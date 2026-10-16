import {useQuery} from "@tanstack/react-query";

import {herdrPanesQueryOptions, type HerdrPaneIndexData} from "../lib/api/herdr";
import {questionAnswerRoute, type QuestionAnswerRoute} from "../lib/question-answer-route";
import {sessionProcessLive, type SessionSummaryState} from "../lib/session-state";
import {useCachedSessionSummary} from "./use-claude-events";

/**
 * Where the session's question cards send an answer, from its herdr pane and
 * whether its CLI still runs (hooks saw it start, or the registry-backed session
 * list gives it a live state). Unknown liveness or panes keep the cards read-only.
 */
export function sessionAnswerRoute({
	sessionId,
	hookActive,
	summary,
	herdr,
}: {
	sessionId: string;
	hookActive: boolean;
	summary: {state: SessionSummaryState} | undefined;
	herdr: HerdrPaneIndexData | undefined;
}): QuestionAnswerRoute {
	const live =
		!hookActive && summary === undefined
			? null
			: sessionProcessLive({hookActive, summaryState: summary?.state ?? null});
	return questionAnswerRoute({
		live,
		hasLivePane: herdr === undefined ? null : herdr.panes.some((pane) => pane.sessionId === sessionId),
		writesEnabled: herdr?.writesEnabled ?? false,
	});
}

/** `sessionAnswerRoute` for a card outside the session page, reading the cached session list and panes. */
export function useQuestionAnswerRoute(sessionId: string): QuestionAnswerRoute {
	const herdr = useQuery(herdrPanesQueryOptions).data;
	const summary = useCachedSessionSummary(sessionId);
	return sessionAnswerRoute({sessionId, hookActive: false, summary, herdr});
}
