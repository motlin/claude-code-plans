import {hmrDispose, hmrPersist} from "./hmr-persist";
import {
	SESSION_REGISTRY_DIR,
	isPidAlive,
	liveRegistryEntries,
	readSessionRegistry,
	type LivenessProbe,
	type SessionRegistryEntry,
} from "./session-registry";

/** The part of a live registry entry the session state model reads. */
export interface RegistrySessionState {
	sessionId: string;
	pid: number;
	cwd: string;
	startedAt: number;
	status: SessionRegistryEntry["status"];
	waitingFor?: string;
	statusUpdatedAt: number;
}

const live = hmrPersist("sessionRegistryLive", () => new Map<string, RegistrySessionState>());

/** How often registered pids are probed for death, which writes no file the watcher could see. */
const LIVENESS_POLL_MS = 10_000;
/** Coalesces the bursts of change events one registry rewrite produces. */
const REFRESH_DEBOUNCE_MS = 100;

export function getRegistrySessionState(sessionId: string): RegistrySessionState | null {
	return live.get(sessionId) ?? null;
}

export function getRegistrySessionStates(): RegistrySessionState[] {
	return [...live.values()];
}

export function clearSessionRegistry(): void {
	live.clear();
}

function toState(entry: SessionRegistryEntry): RegistrySessionState {
	return {
		sessionId: entry.sessionId,
		pid: entry.pid,
		cwd: entry.cwd,
		startedAt: entry.startedAt,
		status: entry.status,
		...(entry.waitingFor === undefined ? {} : {waitingFor: entry.waitingFor}),
		statusUpdatedAt: entry.statusUpdatedAt,
	};
}

function sameState(a: RegistrySessionState, b: RegistrySessionState): boolean {
	return (
		a.pid === b.pid &&
		a.status === b.status &&
		a.waitingFor === b.waitingFor &&
		a.statusUpdatedAt === b.statusUpdatedAt
	);
}

/** Replace the live map, returning the ids of sessions that appeared, vanished or changed status. */
function applyEntries(entries: readonly SessionRegistryEntry[]): Set<string> {
	const next = new Map<string, RegistrySessionState>();
	for (const entry of entries) {
		const existing = next.get(entry.sessionId);
		// A session resumed in two processes reads as whichever wrote its status last.
		if (existing === undefined || entry.statusUpdatedAt > existing.statusUpdatedAt) {
			next.set(entry.sessionId, toState(entry));
		}
	}
	const changed = new Set<string>();
	for (const [sessionId, state] of next) {
		const previous = live.get(sessionId);
		if (previous === undefined || !sameState(previous, state)) changed.add(sessionId);
	}
	for (const sessionId of live.keys()) {
		if (!next.has(sessionId)) changed.add(sessionId);
	}
	live.clear();
	for (const [sessionId, state] of next) live.set(sessionId, state);
	return changed;
}

/** Re-read the registry directory and keep only entries whose process is still alive. */
export async function refreshSessionRegistry(
	dir: string = SESSION_REGISTRY_DIR,
	probe?: LivenessProbe,
): Promise<Set<string>> {
	const entries = await readSessionRegistry(dir);
	return applyEntries(await liveRegistryEntries(entries, probe));
}

/**
 * Probe only the registered pids with signal 0; a dead one triggers a full
 * refresh, since a crashed CLI leaves its file behind without a write.
 */
export async function pollSessionRegistryLiveness(
	dir: string = SESSION_REGISTRY_DIR,
	probe?: LivenessProbe,
): Promise<Set<string>> {
	const isAlive = probe?.isAlive ?? ((pid: number) => isPidAlive(pid));
	const anyDead = [...live.values()].some((state) => !isAlive(state.pid));
	return anyDead ? refreshSessionRegistry(dir, probe) : new Set();
}

interface Monitor {
	onChange: (sessionIds: Set<string>) => void;
	dir: string;
	probe: LivenessProbe | undefined;
	timer: ReturnType<typeof setInterval>;
	debounce: ReturnType<typeof setTimeout> | null;
	queue: Promise<void>;
}

let monitor: Monitor | null = null;

hmrDispose(stopSessionRegistryMonitor);

function enqueue(run: () => Promise<Set<string>>): void {
	const current = monitor;
	if (current === null) return;
	current.queue = current.queue
		.then(run)
		.then((changed) => {
			if (changed.size > 0 && monitor === current) current.onChange(changed);
		})
		.catch(() => {
			// The next file event or poll retries a failed read.
		});
}

/**
 * Load the registry, then keep it current: the watcher calls
 * `scheduleSessionRegistryRefresh` on file events, and a modest poll catches
 * processes that die without rewriting their file.
 */
export function startSessionRegistryMonitor({
	onChange,
	dir = SESSION_REGISTRY_DIR,
	pollMs = LIVENESS_POLL_MS,
	probe,
}: {
	onChange: (sessionIds: Set<string>) => void;
	dir?: string;
	pollMs?: number;
	probe?: LivenessProbe;
}): void {
	stopSessionRegistryMonitor();
	monitor = {
		onChange,
		dir,
		timer: setInterval(() => {
			if (live.size > 0) enqueue(async () => pollSessionRegistryLiveness(dir, probe));
		}, pollMs),
		probe,
		debounce: null,
		queue: Promise.resolve(),
	};
	monitor.timer.unref();
	enqueue(async () => refreshSessionRegistry(dir, probe));
}

export function scheduleSessionRegistryRefresh(): void {
	const current = monitor;
	if (current === null) return;
	if (current.debounce !== null) clearTimeout(current.debounce);
	current.debounce = setTimeout(() => {
		current.debounce = null;
		enqueue(async () => refreshSessionRegistry(current.dir, current.probe));
	}, REFRESH_DEBOUNCE_MS);
}

export function stopSessionRegistryMonitor(): void {
	if (monitor === null) return;
	clearInterval(monitor.timer);
	if (monitor.debounce !== null) clearTimeout(monitor.debounce);
	monitor = null;
}
