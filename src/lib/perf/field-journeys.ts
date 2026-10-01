// The app's field journeys (plan .llm/perf/measurement-plan.md §2.2 F1–F12), each a sample id timed by ./journey.ts:
// F1/F2 for J1 (launch to home), F3/F4 for J2 (deep link to a session), F5 for J3 (switching sessions from a row),
// F6/F7 for J4 (live append), F8–F10 for J5 (composer typing and sending) and F11/F12 for J6 (the ⌘K palette).

import type {QueryClient} from "@tanstack/react-query";
import {sessionQueryKeys} from "../api/sessions";
import type {JsonValue} from "../hook-events";
import {defaultJourneyTracker, PERF_ANCHORS, transcriptRowAt, type JourneyTracker} from "./journey";

const SESSION_PATH = /^\/session\/([^/]+)\/?$/;

/** Narrows `selector` to the session view of `sessionId`, so another session's rows never end its journey. */
function sessionAnchor(sessionId: string, selector: string): string {
	return `${sessionView(sessionId)} ${selector}`;
}

function sessionView(sessionId: string): string {
	return `[data-perf-session=${JSON.stringify(sessionId)}]`;
}

/** The session whose composer submit is waiting for its prompt's JSONL row (F10), per tracker. */
const awaitingPromptRow = new WeakMap<JourneyTracker, string>();

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

export interface LinesAppended {
	sessionId: string;
	/** The JSONL mtime in epoch ms; absent from a payload sent by an older server. */
	writtenAt?: number;
	lines: readonly Record<string, JsonValue>[];
}

/** A prompt the user typed, as opposed to a tool result or a meta line that rides on a user record. */
function isTypedPrompt(line: Record<string, JsonValue>): boolean {
	if (line["type"] !== "user" || line["isMeta"] === true) return false;
	const message = line["message"];
	if (message === null || typeof message !== "object" || Array.isArray(message)) return false;
	const content = message["content"];
	if (typeof content === "string") return content.trim() !== "";
	return Array.isArray(content) && content.some((block) => isObject(block) && block["type"] === "text");
}

function isObject(value: JsonValue): value is {[key: string]: JsonValue} {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Starts the J4 journeys for an SSE append to a session on screen whose records start at JSONL index `firstLine`:
 * F6 from the JSONL write (`writtenAt`) and F7 from the event's receipt, both ending when a row for one of the appended
 * records is painted. Records that only extend an earlier row (a tool result) or render nothing get no sample. Also
 * ends a pending F10 when the append carries the submitted prompt's own row.
 */
export function startLiveAppendJourneys(
	event: Pick<Event, "type" | "timeStamp">,
	appended: LinesAppended,
	firstLine: number,
	tracker: JourneyTracker | undefined = defaultJourneyTracker(),
): void {
	if (!tracker || appended.lines.length === 0) return;
	const {sessionId, writtenAt, lines} = appended;
	if (!document.querySelector(sessionView(sessionId))) return;

	const rows = lines.map((_, offset) => sessionAnchor(sessionId, transcriptRowAt(firstLine + offset))).join(", ");
	if (writtenAt !== undefined) {
		tracker.startJourney("F6", {trigger: {type: "jsonl-write", epochMs: writtenAt}});
		void tracker.endJourneyWhenRendered("F6", rows);
	}
	tracker.startJourney("F7", {trigger: event});
	void tracker.endJourneyWhenRendered("F7", rows);

	if (awaitingPromptRow.get(tracker) !== sessionId) return;
	const promptOffset = lines.findIndex(isTypedPrompt);
	if (promptOffset === -1) return;
	awaitingPromptRow.delete(tracker);
	void tracker.endJourneyWhenRendered("F10", sessionAnchor(sessionId, transcriptRowAt(firstLine + promptOffset)));
}

/** Starts F8 from a composer keydown, ending at the next paint (its Event Timing entry when the browser has one). */
export function startComposerKeystrokeJourney(
	event: KeyboardEvent,
	tracker: JourneyTracker | undefined = defaultJourneyTracker(),
): void {
	if (!tracker || event.isComposing) return;
	tracker.startJourney("F8", {trigger: event});
	void tracker.endJourneyAtNextPaint("F8");
}

/**
 * Starts the J5 send journeys from the keydown or click that submitted the session composer: F9 ends when the pending
 * prompt row shows (skipped while an earlier one is still on screen, which would end it at once), and F10 ends when
 * the prompt's own JSONL row arrives over SSE and paints. F10 includes the Claude CLI's latency, so it is reported
 * but is not a target.
 */
export function startComposerSubmitJourneys(
	event: Event,
	sessionId: string,
	tracker: JourneyTracker | undefined = defaultJourneyTracker(),
): void {
	if (!tracker) return;
	const pending = sessionAnchor(sessionId, PERF_ANCHORS.pendingPrompt);
	if (!document.querySelector(pending)) {
		tracker.startJourney("F9", {trigger: event});
		void tracker.endJourneyWhenRendered("F9", pending);
	}
	tracker.startJourney("F10", {trigger: event});
	awaitingPromptRow.set(tracker, sessionId);
}

/** Starts F11 from the shortcut keydown that opens the palette, ending when it paints with rows. */
export function startPaletteOpenJourney(
	event: KeyboardEvent,
	tracker: JourneyTracker | undefined = defaultJourneyTracker(),
): void {
	if (!tracker || document.querySelector(PERF_ANCHORS.commandPalette)) return;
	tracker.startJourney("F11", {trigger: event});
	void tracker.endJourneyWhenRendered("F11", PERF_ANCHORS.commandPaletteRow);
}

/**
 * Starts F12 from a keydown that edits the palette query (a character, Backspace or Delete), ending when the results
 * list paints for it. The local ranking renders synchronously with the input, so this is the local-results time.
 */
export function startPaletteSearchJourney(
	event: KeyboardEvent,
	tracker: JourneyTracker | undefined = defaultJourneyTracker(),
): void {
	if (!tracker || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
	if (event.key.length !== 1 && event.key !== "Backspace" && event.key !== "Delete") return;
	tracker.startJourney("F12", {trigger: event});
	void tracker.endJourneyWhenRendered("F12", PERF_ANCHORS.commandPaletteResults);
}
