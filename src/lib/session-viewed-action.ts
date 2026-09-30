import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import type {ActiveSessionEntry} from "./active-session-store";
import type * as schema from "./db/schema";
import {
	getCurrentSessionMessageIndex,
	getSessionViewedState,
	markSessionReviewed,
	markSessionUnreviewed,
	type DurableSessionViewedState,
} from "./db/viewed-state";
import {DOMAIN_EVENTS, type SessionSummaryPayload} from "./hook-events";
import {buildSessionSummaryPayloadFromDb} from "./session-summary";

type IndexDb = BetterSQLite3Database<typeof schema>;

interface SessionViewedActionArgs {
	db: IndexDb;
	sessionId: string;
	action: "reviewed" | "unreviewed";
	/** Transcript position the client saw; defaults to the indexed last message. */
	messageIndex?: number;
	broadcast: (type: string, data: Record<string, unknown>) => void;
	activeSessionLookup?: (sessionId: string) => ActiveSessionEntry | null;
}

/**
 * Apply a seen/unseen action to the durable viewed state, then broadcast the
 * resulting session summary so every open tab converges on the server's
 * `unseen` flag and bucket.
 */
export function applySessionViewedAction({
	db,
	sessionId,
	action,
	messageIndex = getCurrentSessionMessageIndex(db, sessionId),
	broadcast,
	activeSessionLookup,
}: SessionViewedActionArgs): DurableSessionViewedState {
	if (action === "reviewed") markSessionReviewed(db, sessionId, messageIndex);
	else markSessionUnreviewed(db, sessionId, messageIndex);

	const summary = buildSessionSummaryPayloadFromDb(db, sessionId, activeSessionLookup);
	if (summary) {
		broadcast(DOMAIN_EVENTS.SESSION_UPDATED, {
			session: summary,
		} satisfies {session: SessionSummaryPayload});
	}
	return getSessionViewedState(db, sessionId, messageIndex);
}
