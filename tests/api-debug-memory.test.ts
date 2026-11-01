import {describe, expect, it} from "vite-plus/test";
import {openTestDb} from "../src/lib/db/connection";
import {collectMemoryStats, MemoryStatsResponse} from "../src/lib/api/debug-memory";

describe("debug memory stats", () => {
	it("reports process, V8 heap and SQLite memory numbers that pass the response contract", () => {
		const db = openTestDb();
		try {
			const stats = collectMemoryStats(db);
			const parsed = MemoryStatsResponse.parse(stats);
			expect({
				keys: Object.keys(parsed).toSorted(),
				processKeys: Object.keys(parsed.process).toSorted(),
				sqliteDbs: Object.keys(parsed.sqlite.databases).toSorted(),
				indexPageSizePositive: parsed.sqlite.databases.index.pageSize > 0,
				rssPositive: parsed.process.rss > 0,
			}).toStrictEqual({
				keys: ["heap", "process", "sqlite", "uptimeSeconds"],
				processKeys: ["arrayBuffers", "external", "heapTotal", "heapUsed", "rss"],
				sqliteDbs: ["index", "summaries"],
				indexPageSizePositive: true,
				rssPositive: true,
			});
		} finally {
			db.close();
		}
	});

	it("rejects fields outside the response contract", () => {
		const db = openTestDb();
		try {
			expect(MemoryStatsResponse.safeParse({...collectMemoryStats(db), unexpectedTestField: 1}).success).toBe(
				false,
			);
		} finally {
			db.close();
		}
	});
});
