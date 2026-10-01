// The app's field journeys (plan .llm/perf/measurement-plan.md §2.2 F1–F5), each a sample id timed by ./journey.ts:
// F1/F2 for J1 (launch to home), F3/F4 for J2 (deep link to a session) and F5 for J3 (switching sessions from a row).

import type {QueryClient} from "@tanstack/react-query";
import {sessionQueryKeys} from "../api/sessions";
import {defaultJourneyTracker, PERF_ANCHORS, type JourneyTracker} from "./journey";

const SESSION_PATH = /^\/session\/([^/]+)\/?$/;

/** Narrows `selector` to the session view of `sessionId`, so another session's rows never end its journey. */
function sessionAnchor(sessionId: string, selector: string): string {
	return `[data-perf-session=${JSON.stringify(sessionId)}] ${selector}`;
}

/**
 * Starts the journeys timed from navigation start for the route the app launched on: F1 (sidebar recents and the
 * home sections have rows) and F2 (the app frame replaced the shell) on home, F3 (the last transcript row) and F4
 * (the header with the real title) on a session deep link.
 */
export function startLaunchJourneys(
	pathname: string,
	tracker: JourneyTracker | undefined = defaultJourneyTracker(),
): void {
	if (!tracker) return;
	if (pathname === "/") {
		tracker.startJourney("F1", {trigger: "navigation"});
		tracker.startJourney("F2", {trigger: "navigation"});
		void tracker.endJourneyWhenRendered("F1", [PERF_ANCHORS.sidebarRecentsRow, PERF_ANCHORS.homeSections]);
		void tracker.endJourneyWhenRendered("F2", PERF_ANCHORS.main);
		return;
	}
	const encodedId = SESSION_PATH.exec(pathname)?.[1];
	if (encodedId === undefined) return;
	const sessionId = decodeURIComponent(encodedId);
	tracker.startJourney("F3", {trigger: "navigation"});
	tracker.startJourney("F4", {trigger: "navigation"});
	void tracker.endJourneyWhenRendered("F3", sessionAnchor(sessionId, PERF_ANCHORS.lastTranscriptRow));
	void tracker.endJourneyWhenRendered("F4", sessionAnchor(sessionId, PERF_ANCHORS.header));
}

/**
 * Starts F5 from a plain primary-button pointerdown on a row that opens `sessionId`, ending when that session's
 * last transcript row is painted. Records whether the hover prefetch had already cached its detail and transcript.
 */
export function startSessionSwitchJourney(
	event: PointerEvent,
	sessionId: string,
	queryClient: QueryClient,
	tracker: JourneyTracker | undefined = defaultJourneyTracker(),
): void {
	if (!tracker) return;
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	const anchor = sessionAnchor(sessionId, PERF_ANCHORS.lastTranscriptRow);
	if (document.querySelector(anchor)) return;
	const prefetchHit =
		queryClient.getQueryData(sessionQueryKeys.detail(sessionId)) !== undefined &&
		queryClient.getQueryData(sessionQueryKeys.transcript(sessionId)) !== undefined;
	tracker.startJourney("F5", {trigger: event, prefetchHit});
	void tracker.endJourneyWhenRendered("F5", anchor);
}
