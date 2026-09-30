import {desc, eq, inArray} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import type {Routine} from "../api/routines";
import {routineNextRunAt, routineStatus, type ExtractedRoutine, type LiveSessionRoutines} from "../routines";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

/** Replaces the routines one primary transcript scheduled, so a reindex is idempotent. */
export function replaceRoutines(
	db: IndexDb,
	source: {filePath: string; sessionId: string; projectId: string},
	routines: readonly ExtractedRoutine[],
): void {
	db.transaction((transaction) => {
		transaction.delete(schema.routines).where(eq(schema.routines.filePath, source.filePath)).run();
		for (const routine of routines) {
			const row: typeof schema.routines.$inferInsert = {
				...routine,
				recurring: routine.recurring ? 1 : 0,
				durable: routine.durable ? 1 : 0,
				sessionId: source.sessionId,
				projectId: source.projectId,
				filePath: source.filePath,
			};
			transaction
				.insert(schema.routines)
				.values(row)
				.onConflictDoUpdate({target: schema.routines.toolUseId, set: row})
				.run();
		}
	});
}

export function deleteRoutinesForSessions(db: IndexDb, sessionIds: readonly string[]): void {
	if (sessionIds.length === 0) return;
	db.delete(schema.routines)
		.where(inArray(schema.routines.sessionId, [...sessionIds]))
		.run();
}

/**
 * Every indexed routine, newest first, with its Active/Completed status and next
 * run resolved against the sessions that are running right now.
 */
export function getRoutines(
	db: IndexDb,
	{now, liveSessions}: {now: number; liveSessions: ReadonlyMap<string, LiveSessionRoutines>},
): Routine[] {
	const rows = db
		.select({routine: schema.routines, sessionTitle: schema.sessions.title})
		.from(schema.routines)
		.leftJoin(schema.sessions, eq(schema.sessions.id, schema.routines.sessionId))
		.orderBy(desc(schema.routines.createdAt), desc(schema.routines.toolUseId))
		.all();

	return rows.map(({routine: row, sessionTitle}): Routine => {
		const extracted: ExtractedRoutine = {
			toolUseId: row.toolUseId,
			recordUuid: row.recordUuid,
			kind: row.kind,
			routineId: row.routineId,
			name: row.name,
			schedule: row.schedule,
			humanSchedule: row.humanSchedule,
			delaySeconds: row.delaySeconds,
			runOnceAt: row.runOnceAt,
			recurring: row.recurring === 1,
			durable: row.durable === 1,
			prompt: row.prompt,
			createdAt: row.createdAt,
			deletedAt: row.deletedAt,
		};
		const status = routineStatus(extracted, liveSessions.get(row.sessionId), now);
		return {
			...extracted,
			sessionId: row.sessionId,
			projectId: row.projectId,
			sessionTitle,
			status,
			nextRunAt: status === "active" ? routineNextRunAt(extracted, now) : null,
		};
	});
}
