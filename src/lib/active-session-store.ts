import {homedir} from 'node:os';
import {join, basename} from 'node:path';

export interface ActiveSessionEntry {
	sessionId: string;
	cwd: string;
	model: string;
	startedAt: number;
	lastActivity: number;
}

// Persist on globalThis to survive Vite HMR reloads.
// Without this, each reload creates a new Map and setInterval
// while the old ones leak in the previous module closure.
interface StoreGlobals {
	__activeSessionStore: Map<string, ActiveSessionEntry>;
	__sweepTimer: ReturnType<typeof setInterval> | null;
}

const g = globalThis as unknown as Partial<StoreGlobals>;
if (!g.__activeSessionStore) g.__activeSessionStore = new Map();

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function markSessionActive(sessionId: string, meta: {cwd: string; model?: string}): void {
	const existing = g.__activeSessionStore!.get(sessionId);
	if (existing) {
		existing.lastActivity = Date.now();
		existing.cwd = meta.cwd;
	} else {
		g.__activeSessionStore!.set(sessionId, {
			sessionId,
			cwd: meta.cwd,
			model: meta.model ?? '',
			startedAt: Date.now(),
			lastActivity: Date.now(),
		});
	}
}

export function markSessionEnded(sessionId: string): void {
	g.__activeSessionStore!.delete(sessionId);
}

export function touchSession(sessionId: string): void {
	const entry = g.__activeSessionStore!.get(sessionId);
	if (entry) {
		entry.lastActivity = Date.now();
	}
}

export function getActiveSessionEntries(): ActiveSessionEntry[] {
	return [...g.__activeSessionStore!.values()];
}

export function isSessionActiveInStore(sessionId: string): boolean {
	return g.__activeSessionStore!.has(sessionId);
}

export function hasAnyActiveSessions(): boolean {
	return g.__activeSessionStore!.size > 0;
}

export function deriveProjectDir(cwd: string): string {
	return basename(cwd);
}

export function deriveSessionIdFromPath(filePath: string): string | null {
	const name = basename(filePath);
	if (!name.endsWith('.jsonl')) return null;
	const projectsDir = join(homedir(), '.claude', 'projects');
	if (!filePath.startsWith(projectsDir)) return null;
	return name.replace(/\.jsonl$/, '');
}

function sweep(): void {
	const now = Date.now();
	for (const [id, entry] of g.__activeSessionStore!) {
		if (now - entry.lastActivity > STALE_THRESHOLD_MS) {
			g.__activeSessionStore!.delete(id);
		}
	}
}

export function startSweep(): void {
	// Clear any previous interval from a prior HMR reload
	if (g.__sweepTimer) {
		clearInterval(g.__sweepTimer);
	}
	g.__sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
}

export function stopSweep(): void {
	if (g.__sweepTimer) {
		clearInterval(g.__sweepTimer);
		g.__sweepTimer = null;
	}
}
