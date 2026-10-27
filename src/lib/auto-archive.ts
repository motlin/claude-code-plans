import {and, eq, lt, notInArray} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {z} from "zod";
import * as schema from "./db/schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface SweepOptions {
	now: number;
	/** Days without JSONL activity before a session is archived; 0 (Never) archives nothing. */
	days: number;
	/** Sessions that must stay unarchived: running, waiting for input, pinned, open or in a live pane. */
	keepIds: ReadonlySet<string>;
	/** The JSONL's mtime on disk right now, or null when it can't be read; guards a stale index. */
	fileMtimeMs: (filePath: string) => number | null;
	archive: (sessionId: string) => void;
}

/**
 * Archive every main-thread session whose newest JSONL write is older than `days` days, skipping
 * kept and already archived sessions. Returns the archived ids, oldest activity first.
 */
export function sweepInactiveSessions(db: IndexDb, {now, days, keepIds, fileMtimeMs, archive}: SweepOptions): string[] {
	if (days <= 0) return [];
	const cutoff = now - days * DAY_MS;
	const archivedIds = db.select({sessionId: schema.archivedSessions.sessionId}).from(schema.archivedSessions);
	const candidates = db
		.select({id: schema.sessions.id, filePath: schema.sessions.filePath})
		.from(schema.sessions)
		.where(
			and(
				lt(schema.sessions.mtimeMs, cutoff),
				eq(schema.sessions.isSidechain, 0),
				notInArray(schema.sessions.id, archivedIds),
			),
		)
		.orderBy(schema.sessions.mtimeMs)
		.all();

	const archived: string[] = [];
	for (const {id, filePath} of candidates) {
		if (keepIds.has(id)) continue;
		const onDisk = fileMtimeMs(filePath);
		if (onDisk !== null && onDisk >= cutoff) continue;
		archive(id);
		archived.push(id);
	}
	return archived;
}

export interface AutoArchiveRunnerDeps {
	db: IndexDb;
	now: () => number;
	/** Reads the current setting; re-read after every await so a toggle mid-run wins. */
	readDays: () => number;
	collectKeepIds: () => Promise<ReadonlySet<string>>;
	fileMtimeMs: SweepOptions["fileMtimeMs"];
	archive: SweepOptions["archive"];
}

/**
 * One sweep at a time. Nothing is collected while the setting is Never, and the setting is read
 * again after the kept ids arrive, so turning it off during a run archives nothing.
 */
export function createAutoArchiveRunner(deps: AutoArchiveRunnerDeps): {run: () => Promise<string[]>} {
	let running = false;
	return {
		run: async () => {
			if (running || deps.readDays() <= 0) return [];
			running = true;
			try {
				const keepIds = await deps.collectKeepIds();
				// The sweep below is synchronous, so this read is the setting it runs under.
				const days = deps.readDays();
				if (days <= 0) return [];
				return sweepInactiveSessions(deps.db, {
					now: deps.now(),
					days,
					keepIds,
					fileMtimeMs: deps.fileMtimeMs,
					archive: deps.archive,
				});
			} finally {
				running = false;
			}
		},
	};
}

const ReportIdSchema = z.string().min(1).max(200);

/**
 * What one tab reports: its browser's pins (localStorage, invisible to the server otherwise) and
 * the sessions the tab has open. Pins are per browser; open sessions are per tab.
 */
export const KeepReportSchema = z.strictObject({
	browserId: ReportIdSchema,
	tabId: ReportIdSchema,
	pinnedIds: z.array(ReportIdSchema).max(5000),
	openIds: z.array(ReportIdSchema).max(100),
});

export type KeepReport = z.infer<typeof KeepReportSchema>;

const PersistedKeepSchema = z.strictObject({
	pins: z.record(z.string(), z.array(z.string())),
	open: z.record(z.string(), z.strictObject({openIds: z.array(z.string()), reportedAt: z.number()})),
});

type PersistedKeep = z.infer<typeof PersistedKeepSchema>;

/**
 * Sessions browsers ask to keep. A browser's latest pins count until it reports again (a closed
 * browser still pinned them); a tab's open sessions count until `openLeaseMs` after its last
 * report. Both survive a restart.
 */
export function createKeepRegistry({
	now,
	openLeaseMs,
	load,
	save,
}: {
	now: () => number;
	openLeaseMs: number;
	load?: () => unknown;
	save?: (data: PersistedKeep) => void;
}) {
	const pins = new Map<string, readonly string[]>();
	const open = new Map<string, {openIds: readonly string[]; reportedAt: number}>();
	const persisted = PersistedKeepSchema.safeParse(load?.());
	if (persisted.success) {
		for (const [browserId, ids] of Object.entries(persisted.data.pins)) pins.set(browserId, ids);
		for (const [tabKey, tab] of Object.entries(persisted.data.open)) open.set(tabKey, tab);
	}

	function pruneExpiredTabs(at: number): void {
		for (const [tabKey, tab] of open) if (at - tab.reportedAt > openLeaseMs) open.delete(tabKey);
	}

	return {
		report({browserId, tabId, pinnedIds, openIds}: KeepReport): void {
			const at = now();
			pruneExpiredTabs(at);
			pins.set(browserId, pinnedIds);
			open.set(JSON.stringify([browserId, tabId]), {openIds, reportedAt: at});
			save?.({
				pins: Object.fromEntries([...pins].map(([id, ids]) => [id, [...ids]])),
				open: Object.fromEntries(
					[...open].map(([tabKey, tab]) => [tabKey, {openIds: [...tab.openIds], reportedAt: tab.reportedAt}]),
				),
			});
		},
		keptIds(): Set<string> {
			const kept = new Set<string>();
			const at = now();
			for (const ids of pins.values()) for (const id of ids) kept.add(id);
			for (const tab of open.values()) {
				if (at - tab.reportedAt <= openLeaseMs) for (const id of tab.openIds) kept.add(id);
			}
			return kept;
		},
	};
}
