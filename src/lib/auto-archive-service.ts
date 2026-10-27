import {readFileSync, renameSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {getActiveSessionEntries} from "./active-session-store";
import {scanActiveSessions} from "./active-sessions";
import {createAutoArchiveRunner, createKeepRegistry, type KeepReport} from "./auto-archive";
import {readAutoArchiveInactiveDays} from "./config";
import {getDb} from "./db";
import {getCacheDir} from "./db/connection";
import {hmrPersist} from "./hmr-persist";
import {applySessionArchiveAction} from "./session-archive";
import {getRegistrySessionStates} from "./session-registry-store";
import {getSessionTerminalHosts} from "./session-terminal-hosts";
import {broadcastTyped} from "./sse-broadcast";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** The startup sweep waits for open browsers to reconnect and report their open sessions. */
const STARTUP_DELAY_MS = 5 * 60 * 1000;
/** Browsers re-report every few minutes; an open session stays kept this long after the last report. */
const OPEN_LEASE_MS = 30 * 60 * 1000;

function keepFile(): string {
	return join(getCacheDir(), "auto-archive-keep.json");
}

const keepRegistry = hmrPersist("autoArchiveKeepRegistry", () =>
	createKeepRegistry({
		now: Date.now,
		openLeaseMs: OPEN_LEASE_MS,
		load: () => {
			try {
				return JSON.parse(readFileSync(keepFile(), "utf8")) as unknown;
			} catch {
				return null;
			}
		},
		save: (data) => {
			const file = keepFile();
			const temp = `${file}.${process.pid}.tmp`;
			try {
				writeFileSync(temp, JSON.stringify(data));
				renameSync(temp, file);
			} catch (err) {
				console.error("Failed to save auto-archive keep list:", err);
			}
		},
	}),
);

export function reportKeptSessions(report: KeepReport): void {
	keepRegistry.report(report);
}

/** Every session the sweeper must leave alone: anything live, waiting, in a terminal pane, pinned or open. */
async function collectKeepIds(): Promise<ReadonlySet<string>> {
	const kept = new Set<string>(keepRegistry.keptIds());
	for (const session of await scanActiveSessions()) kept.add(session.sessionId);
	for (const entry of getActiveSessionEntries()) kept.add(entry.sessionId);
	for (const live of getRegistrySessionStates()) kept.add(live.sessionId);
	for (const sessionId of getSessionTerminalHosts().keys()) kept.add(sessionId);
	return kept;
}

function fileMtimeMs(filePath: string): number | null {
	try {
		return statSync(filePath).mtimeMs;
	} catch {
		return null;
	}
}

let runner: ReturnType<typeof createAutoArchiveRunner> | null = null;

function getRunner(): ReturnType<typeof createAutoArchiveRunner> {
	return (runner ??= createAutoArchiveRunner({
		db: getDb().index,
		now: Date.now,
		readDays: () => readAutoArchiveInactiveDays(),
		collectKeepIds,
		fileMtimeMs,
		archive: (sessionId) => {
			applySessionArchiveAction({db: getDb().index, sessionId, archived: true, broadcast: broadcastTyped});
		},
	}));
}

/** Sweep now (no-op while the setting is Never or a sweep is running) and log what it archived. */
export async function runAutoArchiveSweep(): Promise<void> {
	try {
		const archived = await getRunner().run();
		if (archived.length > 0) console.log(`Auto-archive: archived ${archived.length} inactive sessions`);
	} catch (err) {
		console.error("Auto-archive sweep failed:", err);
	}
}

let startupTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;

/** Sweep shortly after startup, then hourly. */
export function startAutoArchive(): void {
	stopAutoArchive();
	startupTimer = setTimeout(() => {
		void runAutoArchiveSweep();
	}, STARTUP_DELAY_MS);
	startupTimer.unref();
	intervalTimer = setInterval(() => {
		void runAutoArchiveSweep();
	}, SWEEP_INTERVAL_MS);
	intervalTimer.unref();
}

export function stopAutoArchive(): void {
	if (startupTimer !== null) clearTimeout(startupTimer);
	if (intervalTimer !== null) clearInterval(intervalTimer);
	startupTimer = null;
	intervalTimer = null;
}
