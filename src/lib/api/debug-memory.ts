import {getHeapStatistics} from "node:v8";
import {z} from "zod";
import type {AppDb} from "../db/connection";

const SqliteDbMemory = z.strictObject(
	{
		pageSize: z.number(),
		pageCount: z.number(),
		freelistCount: z.number(),
		/** PRAGMA cache_size: negative means KiB, positive means pages. */
		cacheSize: z.number(),
		mmapSize: z.number(),
		walPages: z.number(),
	},
);

/**
 * Process, V8 heap and SQLite memory numbers for diagnosing RSS growth (`GET /api/debug/memory`).
 *
 * On macOS `process.rss` overstates live memory: pages that libmalloc has freed
 * and marked reusable (MALLOC_MEDIUM after streaming a large transcript in 64 KiB
 * chunks) stay resident until the kernel needs them, so RSS swings by gigabytes
 * while the physical footprint stays flat. Compare against
 * `vmmap --summary <pid>` "Physical footprint" before calling RSS growth a leak.
 */
export const MemoryStatsResponse = z.strictObject(
	{
		uptimeSeconds: z.number(),
		process: z.strictObject(
			{
				rss: z.number(),
				heapTotal: z.number(),
				heapUsed: z.number(),
				external: z.number(),
				arrayBuffers: z.number(),
			},
		),
		heap: z.strictObject(
			{
				totalHeapSize: z.number(),
				usedHeapSize: z.number(),
				heapSizeLimit: z.number(),
				mallocedMemory: z.number(),
				peakMallocedMemory: z.number(),
				externalMemory: z.number(),
				numberOfNativeContexts: z.number(),
				numberOfDetachedContexts: z.number(),
			},
		),
		sqlite: z.strictObject(
			{
				databases: z.strictObject(
					{
						index: SqliteDbMemory,
						summaries: SqliteDbMemory,
					},
				),
			},
		),
	},
);
export type MemoryStats = z.infer<typeof MemoryStatsResponse>;

type RawSqlite = AppDb["index"]["$client"];

function pragmaNumber(sqlite: RawSqlite, name: string): number
{
	const value: unknown = sqlite.pragma(
		name,
		{
			simple: true,
		},
	);
	return typeof value === "number" ? value : 0;
}

function walPages(sqlite: RawSqlite): number
{
	// wal_checkpoint(PASSIVE) returns [busy, log, checkpointed]; log is the WAL size in pages.
	// Querying it runs a passive checkpoint, which never blocks writers.
	const rows: unknown = sqlite.pragma("wal_checkpoint(PASSIVE)");
	if (!Array.isArray(rows)) return 0;
	const row: unknown = rows[0];
	if (typeof row !== "object" || row === null || !("log" in row)) return 0;
	return typeof row.log === "number" ? Math.max(row.log, 0) : 0;
}

function sqliteMemory(sqlite: RawSqlite): z.infer<typeof SqliteDbMemory>
{
	return {
		pageSize: pragmaNumber(sqlite, "page_size"),
		pageCount: pragmaNumber(sqlite, "page_count"),
		freelistCount: pragmaNumber(sqlite, "freelist_count"),
		cacheSize: pragmaNumber(sqlite, "cache_size"),
		mmapSize: pragmaNumber(sqlite, "mmap_size"),
		walPages: walPages(sqlite),
	};
}

export function collectMemoryStats(db: AppDb): MemoryStats
{
	const usage = process.memoryUsage();
	const heap = getHeapStatistics();
	return {
		uptimeSeconds: Math.round(process.uptime()),
		process:
		{
			rss: usage.rss,
			heapTotal: usage.heapTotal,
			heapUsed: usage.heapUsed,
			external: usage.external,
			arrayBuffers: usage.arrayBuffers,
		},
		heap:
		{
			totalHeapSize: heap.total_heap_size,
			usedHeapSize: heap.used_heap_size,
			heapSizeLimit: heap.heap_size_limit,
			mallocedMemory: heap.malloced_memory,
			peakMallocedMemory: heap.peak_malloced_memory,
			externalMemory: heap.external_memory,
			numberOfNativeContexts: heap.number_of_native_contexts,
			numberOfDetachedContexts: heap.number_of_detached_contexts,
		},
		sqlite:
		{
			databases:
			{
				index: sqliteMemory(db.index.$client),
				summaries: sqliteMemory(db.summaries.$client),
			},
		},
	};
}
