import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import type * as schema from "./db/schema";
import {setSessionArchived} from "./db/queries";
import {DOMAIN_EVENTS, type SessionSummaryPayload} from "./hook-events";
import {buildSessionSummaryPayloadFromDb} from "./session-summary";

type IndexDb = BetterSQLite3Database<typeof schema>;

interface SessionArchiveActionArgs {
	db: IndexDb;
	sessionId: string;
	archived: boolean;
	broadcast: (type: string, data: Record<string, unknown>) => void;
}

/**
 * Set the app-side archive flag (the JSONL is never touched), then broadcast
 * the session summary so every open tab refetches its lists.
 */
export function applySessionArchiveAction({db, sessionId, archived, broadcast}: SessionArchiveActionArgs): boolean {
	const result = setSessionArchived(db, sessionId, archived);
	const summary = buildSessionSummaryPayloadFromDb(db, sessionId);
	if (summary) {
		broadcast(DOMAIN_EVENTS.SESSION_UPDATED, {
			session: summary,
		} satisfies {session: SessionSummaryPayload});
	}
	return result;
}
