import {eq, inArray, sql} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {localDateKey, type HomeStatsDay, type UsageDailyRow} from "../home-stats";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

/** Replaces one primary transcript's per-day usage, so a reindex is idempotent. */
export function replaceUsageDaily(
	db: IndexDb,
	source: {filePath: string; sessionId: string},
	rows: readonly UsageDailyRow[],
): void {
	db.transaction((transaction) => {
		transaction.delete(schema.usageDaily).where(eq(schema.usageDaily.filePath, source.filePath)).run();
		for (const row of rows) {
			transaction
				.insert(schema.usageDaily)
				.values({...row, filePath: source.filePath, sessionId: source.sessionId})
				.run();
		}
	});
}

export function deleteUsageDailyForSessions(db: IndexDb, sessionIds: readonly string[]): void {
	if (sessionIds.length === 0) return;
	db.delete(schema.usageDaily)
		.where(inArray(schema.usageDaily.sessionId, [...sessionIds]))
		.run();
}

/**
 * Every local day with activity, oldest first: sessions started (by hour) from
 * the sessions table, messages and input + output tokens per model from
 * `usage_daily`.
 */
export function getHomeStatsDays(db: IndexDb): HomeStatsDay[] {
	const byDate = new Map<string, HomeStatsDay>();
	const dayFor = (date: string): HomeStatsDay => {
		let row = byDate.get(date);
		if (row === undefined) {
			row = {
				date,
				sessions: 0,
				messages: 0,
				hourCounts: Array.from({length: 24}, () => 0),
				tokensByModel: null,
			};
			byDate.set(date, row);
		}
		return row;
	};

	const sessionStarts = db
		.select({createdAt: schema.sessions.createdAt})
		.from(schema.sessions)
		.where(eq(schema.sessions.isSidechain, 0))
		.all();
	for (const {createdAt} of sessionStarts) {
		const at = new Date(createdAt);
		if (Number.isNaN(at.getTime())) continue;
		const row = dayFor(localDateKey(at));
		row.sessions++;
		const hour = at.getHours();
		row.hourCounts[hour] = (row.hourCounts[hour] ?? 0) + 1;
	}

	const usage = db
		.select({
			day: schema.usageDaily.day,
			model: schema.usageDaily.model,
			messages: sql<number>`sum(${schema.usageDaily.messages})`,
			tokens: sql<number>`sum(${schema.usageDaily.inputTokens} + ${schema.usageDaily.outputTokens})`,
		})
		.from(schema.usageDaily)
		.groupBy(schema.usageDaily.day, schema.usageDaily.model)
		.all();
	for (const {day, model, messages, tokens} of usage) {
		const row = dayFor(day);
		row.messages += messages;
		if (model !== null) row.tokensByModel = {...row.tokensByModel, [model]: tokens};
	}

	return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
