import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

/** Hide a session from the home action center until it has activity newer than `now`. */
export function dismissHomeSession(db: IndexDb, sessionId: string, now: number = Date.now()): void {
	db.insert(schema.homeDismissals)
		.values({sessionId, dismissedAt: now})
		.onConflictDoUpdate({target: schema.homeDismissals.sessionId, set: {dismissedAt: now}})
		.run();
}

/** Session id to the time it was last dismissed from home. */
export function getHomeDismissals(db: IndexDb): Record<string, number> {
	const rows = db.select().from(schema.homeDismissals).all();
	return Object.fromEntries(rows.map((row) => [row.sessionId, row.dismissedAt]));
}
