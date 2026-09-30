import {hmrPersist, hmrDispose} from "./hmr-persist";
import type {ActivityState} from "./session-state";
import type {HookBackgroundTaskPayload, HookSessionCronPayload} from "./hook-events";
import type {LiveSessionRoutines} from "./routines";
import {touchStoredLiveSubagent} from "./live-subagent-store";

export interface ActiveSessionEntry {
	sessionId: string;
	state: ActivityState;
	cwd: string;
	model: string;
	startedAt: number;
	lastActivity: number;
	claudeEnv: Record<string, string>;
	/**
	 * tmux pane id (e.g. `%593`) the Claude process is running in, taken from
	 * `claude_env.TMUX_PANE`. Stable for the pane's life; empty when the session
	 * is not running inside tmux. Re-stamped on every prompt so it survives a
	 * `claude --resume` into a different pane.
	 */
	tmuxPane: string;
	/**
	 * tmux server socket path scoping `tmuxPane` — the part of `claude_env.TMUX`
	 * before its first comma (`TMUX` is `<socket>,<pid>,<session>`). Empty when
	 * not inside tmux. `%`-pane ids only reset on a server restart, so this
	 * socket disambiguates panes across multiple tmux servers.
	 */
	tmuxServerSocket: string;
	/**
	 * herdr pane id (e.g. `w1:p1`) captured in `HERDR_PANE_ID` when the Claude
	 * process launches. It is re-derived from every fresh env snapshot, but can
	 * become stale after a cross-workspace move because herdr reassigns
	 * `pane_id` while preserving `terminal_id`. Empty when outside herdr.
	 */
	herdrPane: string;
	/**
	 * herdr workspace id containing `herdrPane`, taken from
	 * `claude_env.HERDR_WORKSPACE_ID`. Empty when outside herdr.
	 */
	herdrWorkspace: string;
	/**
	 * herdr JSON API socket path, taken from `claude_env.HERDR_SOCKET_PATH`.
	 * Empty when outside herdr.
	 */
	herdrSocketPath: string;
	/**
	 * Epoch ms of the last hook fired from inside one of this session's
	 * subagents (`agent_id` present), or null when none has been seen. A
	 * liveness heartbeat that never changes the root session's `state`.
	 */
	lastSubagentActivityAt: number | null;
	/** Background work the session's last `Stop` reported (empty before any Stop). */
	backgroundTasks: HookBackgroundTaskPayload[];
	/** Scheduled prompts the session's latest `Stop` reported, and when (absent before any). */
	sessionCrons?: {crons: HookSessionCronPayload[]; reportedAt: number};
}

/**
 * Derive the tmux pane id and server socket from a `claude_env` snapshot.
 * `TMUX` is `<socket>,<serverPid>,<sessionId>`; the socket path is the segment
 * before the first comma. Both fields default to `""` when the vars are absent
 * (session not running inside tmux, or hooks not yet re-installed to forward
 * `TMUX`/`TMUX_PANE`).
 */
function deriveTmux(claudeEnv: Record<string, string> | undefined): {
	tmuxPane: string;
	tmuxServerSocket: string;
} {
	const tmuxPane = claudeEnv?.["TMUX_PANE"] ?? "";
	const tmux = claudeEnv?.["TMUX"] ?? "";
	const tmuxServerSocket = tmux.split(",")[0] ?? "";
	return {tmuxPane, tmuxServerSocket};
}

function deriveHerdr(claudeEnv: Record<string, string> | undefined): {
	herdrPane: string;
	herdrWorkspace: string;
	herdrSocketPath: string;
} {
	return {
		herdrPane: claudeEnv?.["HERDR_PANE_ID"] ?? "",
		herdrWorkspace: claudeEnv?.["HERDR_WORKSPACE_ID"] ?? "",
		herdrSocketPath: claudeEnv?.["HERDR_SOCKET_PATH"] ?? "",
	};
}

/**
 * Stamp a fresh `claude_env` snapshot onto an entry, re-deriving its terminal
 * placement. Callers guard on a present `claudeEnv` so a missing env never
 * clobbers a previously known mapping.
 */
function applyClaudeEnv(entry: ActiveSessionEntry, claudeEnv: Record<string, string>): void {
	entry.claudeEnv = claudeEnv;
	const {tmuxPane, tmuxServerSocket} = deriveTmux(claudeEnv);
	const {herdrPane, herdrWorkspace, herdrSocketPath} = deriveHerdr(claudeEnv);
	entry.tmuxPane = tmuxPane;
	entry.tmuxServerSocket = tmuxServerSocket;
	entry.herdrPane = herdrPane;
	entry.herdrWorkspace = herdrWorkspace;
	entry.herdrSocketPath = herdrSocketPath;
}

const store = hmrPersist("activeSessionStore", () => new Map<string, ActiveSessionEntry>());

function normalizeEntryState(entry: ActiveSessionEntry): ActiveSessionEntry {
	// HMR may retain entries created before these fields existed.
	if (entry.state === undefined) entry.state = "unknown";
	if (entry.lastSubagentActivityAt === undefined) entry.lastSubagentActivityAt = null;
	if (entry.backgroundTasks === undefined) entry.backgroundTasks = [];
	return entry;
}

function findSession(sessionId: string): ActiveSessionEntry | undefined {
	const entry = store.get(sessionId);
	return entry ? normalizeEntryState(entry) : undefined;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

hmrDispose(stopSweep);

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function markSessionActive(
	sessionId: string,
	meta: {cwd: string; model?: string; claudeEnv?: Record<string, string>},
): void {
	const existing = findSession(sessionId);
	if (existing) {
		existing.lastActivity = Date.now();
		existing.cwd = meta.cwd;
		// Only re-derive terminal mappings when a fresh claude_env is supplied.
		// Callers without one (e.g. CwdChanged) must not clobber a known pane.
		if (meta.claudeEnv) applyClaudeEnv(existing, meta.claudeEnv);
	} else {
		const {tmuxPane, tmuxServerSocket} = deriveTmux(meta.claudeEnv);
		const {herdrPane, herdrWorkspace, herdrSocketPath} = deriveHerdr(meta.claudeEnv);
		store.set(sessionId, {
			sessionId,
			state: "unknown",
			cwd: meta.cwd,
			model: meta.model ?? "",
			startedAt: Date.now(),
			lastActivity: Date.now(),
			claudeEnv: meta.claudeEnv ?? {},
			tmuxPane,
			tmuxServerSocket,
			herdrPane,
			herdrWorkspace,
			herdrSocketPath,
			lastSubagentActivityAt: null,
			backgroundTasks: [],
		});
	}
}

export function markSessionEnded(sessionId: string): void {
	store.delete(sessionId);
}

export function setSessionState(sessionId: string, state: ActivityState): void {
	const entry = findSession(sessionId);
	if (entry) entry.state = state;
}

export function touchSession(sessionId: string, meta?: {claudeEnv?: Record<string, string>}): void {
	const entry = findSession(sessionId);
	if (entry) {
		entry.lastActivity = Date.now();
		// Re-stamp terminal mappings when a fresh claude_env is supplied (every
		// UserPromptSubmit) so placement stays correct after a `claude --resume`.
		// Touches without an env (Stop, PostToolUse, …) leave mappings untouched.
		if (meta?.claudeEnv) applyClaudeEnv(entry, meta.claudeEnv);
	}
}

/**
 * Record a hook fired from inside subagent `agentId` of `sessionId`. Keeps the
 * root session and the live subagent node alive (the latter feeds the stale
 * sweep) without touching the root's `state`, which only main-turn hooks own.
 */
export function touchSubagentActivity(sessionId: string, agentId: string): void {
	touchStoredLiveSubagent(agentId);
	const entry = findSession(sessionId);
	if (!entry) return;
	const now = Date.now();
	entry.lastActivity = now;
	entry.lastSubagentActivityAt = now;
}

export function setBackgroundTasks(sessionId: string, backgroundTasks: HookBackgroundTaskPayload[]): void {
	const entry = findSession(sessionId);
	if (entry) entry.backgroundTasks = backgroundTasks;
}

export function setSessionCrons(sessionId: string, crons: HookSessionCronPayload[]): void {
	const entry = findSession(sessionId);
	if (entry) entry.sessionCrons = {crons, reportedAt: Date.now()};
}

/** Each running session's latest Stop `session_crons`, keyed by session id. */
export function liveSessionRoutines(): Map<string, LiveSessionRoutines> {
	return new Map(
		getActiveSessionEntries().map((entry) => [
			entry.sessionId,
			{
				sessionCrons: entry.sessionCrons?.crons ?? null,
				sessionCronsAt: entry.sessionCrons?.reportedAt ?? null,
			},
		]),
	);
}

export function getActiveSessionEntries(): ActiveSessionEntry[] {
	return [...store.values()].map(normalizeEntryState);
}

export function getActiveSessionEntry(sessionId: string): ActiveSessionEntry | null {
	return findSession(sessionId) ?? null;
}

export function isSessionActiveInStore(sessionId: string): boolean {
	return store.has(sessionId);
}

export function hasAnyActiveSessions(): boolean {
	return store.size > 0;
}

export function sweepSessions(target: Map<string, ActiveSessionEntry>): void {
	const now = Date.now();
	for (const [id, entry] of target) {
		if (now - entry.lastActivity > STALE_THRESHOLD_MS) {
			target.delete(id);
		}
	}
}

function sweep(): void {
	sweepSessions(store);
}

export function startSweep(): void {
	stopSweep();
	sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
}

export function stopSweep(): void {
	if (sweepTimer) clearInterval(sweepTimer);
	sweepTimer = null;
}
