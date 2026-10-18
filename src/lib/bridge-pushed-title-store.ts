import {z} from "zod";
import {persistedSessionMap} from "./persisted-session-map";

/**
 * The title this app last pushed to claude.ai/code for each bridged (Remote
 * Control) session, by having its live CLI run `/rename`. A bridged session is
 * titled by its ai-title because claude.ai/code never sees a local custom
 * title — except the one pushed here, which claude.ai/code shows too. The CLI
 * records the rename only as an ordinary custom-title record, so the server
 * remembers which custom title reached claude.ai, across restarts.
 */
const store = persistedSessionMap<string>("bridgePushedTitle", z.string());

/** Mirror the store to `file` from now on, first replacing it with what the file holds. */
export function persistBridgePushedTitlesTo(file: string): void {
	store.persistTo(file);
}

export function bridgePushedTitle(sessionId: string): string | null {
	return store.get(sessionId);
}

/** Remember `title` as the session's pushed title, or forget it for null. */
export function setBridgePushedTitle(sessionId: string, title: string | null): void {
	if (title === null) store.delete(sessionId);
	else store.set(sessionId, title);
}

/** Forget every pushed title, as a fresh process starts. */
export function resetBridgePushedTitles(): void {
	store.reset();
}
