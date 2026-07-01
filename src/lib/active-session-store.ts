import { hmrPersist, hmrDispose } from "./hmr-persist";

export interface ActiveSessionEntry {
  sessionId: string;
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
  const tmuxServerSocket = tmux === "" ? "" : (tmux.split(",")[0] ?? "");
  return { tmuxPane, tmuxServerSocket };
}

/**
 * Stamp a fresh `claude_env` snapshot onto an entry, re-deriving its tmux
 * pane/socket. Callers guard on a present `claudeEnv` so a missing env never
 * clobbers a previously known mapping.
 */
function applyClaudeEnv(entry: ActiveSessionEntry, claudeEnv: Record<string, string>): void {
  entry.claudeEnv = claudeEnv;
  const { tmuxPane, tmuxServerSocket } = deriveTmux(claudeEnv);
  entry.tmuxPane = tmuxPane;
  entry.tmuxServerSocket = tmuxServerSocket;
}

const store = hmrPersist("activeSessionStore", () => new Map<string, ActiveSessionEntry>());

let sweepTimer: ReturnType<typeof setInterval> | null = null;

hmrDispose(() => {
  if (sweepTimer) clearInterval(sweepTimer);
});

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function markSessionActive(
  sessionId: string,
  meta: { cwd: string; model?: string; claudeEnv?: Record<string, string> },
): void {
  const existing = store.get(sessionId);
  if (existing) {
    existing.lastActivity = Date.now();
    existing.cwd = meta.cwd;
    // Only re-derive the tmux mapping when a fresh claude_env is supplied.
    // Callers without one (e.g. CwdChanged) must not clobber a known pane.
    if (meta.claudeEnv) applyClaudeEnv(existing, meta.claudeEnv);
  } else {
    const { tmuxPane, tmuxServerSocket } = deriveTmux(meta.claudeEnv);
    store.set(sessionId, {
      sessionId,
      cwd: meta.cwd,
      model: meta.model ?? "",
      startedAt: Date.now(),
      lastActivity: Date.now(),
      claudeEnv: meta.claudeEnv ?? {},
      tmuxPane,
      tmuxServerSocket,
    });
  }
}

export function markSessionEnded(sessionId: string): void {
  store.delete(sessionId);
}

export function touchSession(
  sessionId: string,
  meta?: { claudeEnv?: Record<string, string> },
): void {
  const entry = store.get(sessionId);
  if (entry) {
    entry.lastActivity = Date.now();
    // Re-stamp the tmux mapping when a fresh claude_env is supplied (every
    // UserPromptSubmit) so the pane stays correct after a `claude --resume`
    // into a new pane. Touches without an env (Stop, PostToolUse, …) leave the
    // existing mapping untouched.
    if (meta?.claudeEnv) applyClaudeEnv(entry, meta.claudeEnv);
  }
}

export function getActiveSessionEntries(): ActiveSessionEntry[] {
  return [...store.values()];
}

export function getActiveSessionEntry(sessionId: string): ActiveSessionEntry | null {
  return store.get(sessionId) ?? null;
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
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
}
