import {homedir} from 'node:os';
import {join, basename} from 'node:path';

export interface ActiveSessionEntry {
	sessionId: string;
	cwd: string;
	model: string;
	startedAt: number;
	lastActivity: number;
}

const store = new Map<string, ActiveSessionEntry>();

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function markSessionActive(sessionId: string, meta: {cwd: string; model?: string}): void {
	const existing = store.get(sessionId);
	if (existing) {
		existing.lastActivity = Date.now();
		existing.cwd = meta.cwd;
	} else {
		store.set(sessionId, {
			sessionId,
			cwd: meta.cwd,
			model: meta.model ?? '',
			startedAt: Date.now(),
			lastActivity: Date.now(),
		});
	}
}

export function markSessionEnded(sessionId: string): void {
	store.delete(sessionId);
}

export function touchSession(sessionId: string): void {
	const entry = store.get(sessionId);
	if (entry) {
		entry.lastActivity = Date.now();
	}
}

export function getActiveSessionEntries(): ActiveSessionEntry[] {
	return [...store.values()];
}

export function isSessionActiveInStore(sessionId: string): boolean {
	return store.has(sessionId);
}

export function hasAnyActiveSessions(): boolean {
	return store.size > 0;
}

export function deriveProjectDir(cwd: string): string {
	// Try to find a matching project dir from cwd
	// The project dir in ~/.claude/projects/ is an encoded version of the cwd
	// We can't easily reverse it, so return the cwd basename as a hint
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
	for (const [id, entry] of store) {
		if (now - entry.lastActivity > STALE_THRESHOLD_MS) {
			store.delete(id);
		}
	}
}

export function startSweep(): void {
	if (!sweepTimer) {
		sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
	}
}

export function stopSweep(): void {
	if (sweepTimer) {
		clearInterval(sweepTimer);
		sweepTimer = null;
	}
}
