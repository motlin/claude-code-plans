import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {metadata, summaries} from "../../src/lib/db/schema";
import {openTestDb, type AppDb} from "../../src/lib/db/connection";
import {currentPerfCounters, withPerfScope, type PerfCounters} from "../../src/lib/perf/server-scope";

let db: AppDb;

beforeEach(() => {
	db = openTestDb();
});

afterEach(() => {
	db.close();
});

function selectMetadata(): void {
	db.index.select().from(metadata).all();
}

function withoutMs(counters: PerfCounters | undefined): unknown {
	if (counters === undefined) return undefined;
	return {...counters, sql: {count: counters.sql.count}};
}

describe("withPerfScope", () => {
	it("counts each SQL statement run inside the scope", async () => {
		const counters = await withPerfScope("three-selects", () => {
			selectMetadata();
			selectMetadata();
			db.summaries.select().from(summaries).all();
			return currentPerfCounters();
		});

		expect(withoutMs(counters)).toStrictEqual({
			sql: {count: 3},
			jsonl: {bytesRead: 0, fullScans: 0},
			proc: {spawned: 0},
		});
		expect(counters?.sql.ms).toBeGreaterThanOrEqual(0);
	});

	it("returns the value of the wrapped function", async () => {
		expect(await withPerfScope("value", () => 42)).toBe(42);
	});

	it("keeps concurrent scopes separate", async () => {
		const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

		const [a, b] = await Promise.all([
			withPerfScope("a", async () => {
				selectMetadata();
				await tick();
				selectMetadata();
				await tick();
				return currentPerfCounters()?.sql.count;
			}),
			withPerfScope("b", async () => {
				await tick();
				selectMetadata();
				await tick();
				selectMetadata();
				selectMetadata();
				selectMetadata();
				return currentPerfCounters()?.sql.count;
			}),
		]);

		expect({a, b}).toStrictEqual({a: 2, b: 4});
	});

	it("counts nothing outside a scope", async () => {
		selectMetadata();
		expect(currentPerfCounters()).toBeUndefined();

		const inner = await withPerfScope("after", () => currentPerfCounters()?.sql.count);
		expect(inner).toBe(0);
	});
});
