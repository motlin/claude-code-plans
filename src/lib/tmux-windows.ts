import { execFile } from "node:child_process";
import { basename } from "node:path";
import { getActiveSessionEntries, type ActiveSessionEntry } from "./active-session-store";

/**
 * A live tmux window running a mapped Claude session. Window numbers/names come
 * straight from tmux (via `window_index`/`window_name`) so they always match the
 * user's real windows, even when there are gaps from renumbering.
 */
export interface TmuxWindow {
  sessionId: string;
  projectName: string;
  windowIndex: number;
  windowName: string;
  windowActive: boolean;
  tmuxPane: string;
  socket: string;
}

/**
 * `list-panes -a` output format. Tab-separated so window names containing spaces
 * survive the split. `list-panes -a` (not `list-windows`) is used so we match the
 * Claude process's exact pane even when it isn't the window's active pane.
 */
const TMUX_FORMAT =
  "#{pane_id}\t#{session_name}\t#{window_index}\t#{window_name}\t#{window_active}";

const TMUX_TIMEOUT_MS = 2000;

interface TmuxPane {
  paneId: string;
  windowIndex: number;
  windowName: string;
  windowActive: boolean;
}

/** Runs `tmux -S <socket> list-panes -a` and resolves its stdout. */
export type TmuxRunner = (socket: string) => Promise<string>;

function runTmuxListPanes(socket: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "tmux",
      ["-S", socket, "list-panes", "-a", "-F", TMUX_FORMAT],
      { timeout: TMUX_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Parse `list-panes -a` output into a pane-id → pane map. Grouped tmux sessions
 * (`main`, `main-grouped-10`, …) repeat the same pane under different session
 * names; deduping by `pane_id` (first wins) collapses them to one window.
 */
export function parseTmuxPanes(stdout: string): Map<string, TmuxPane> {
  const byPaneId = new Map<string, TmuxPane>();
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // Skips field 1 (session_name); see TMUX_FORMAT.
    const [paneId, , windowIndexRaw, windowName, windowActiveRaw] = line.split("\t");
    if (!paneId || windowIndexRaw === undefined) continue;
    const windowIndex = Number.parseInt(windowIndexRaw, 10);
    if (Number.isNaN(windowIndex)) continue;
    if (byPaneId.has(paneId)) continue;
    byPaneId.set(paneId, {
      paneId,
      windowIndex,
      windowName: windowName ?? "",
      windowActive: windowActiveRaw === "1",
    });
  }
  return byPaneId;
}

/**
 * Join live tmux panes against the active-session store to produce the list of
 * mapped Claude windows. Collects store entries carrying a `tmuxPane`, groups
 * them by distinct `tmuxServerSocket`, shells out to tmux once per socket, and
 * joins by `pane_id`. Only matched (Claude) windows are emitted. A tmux failure
 * for a socket (no server / not running) drops just that socket's windows.
 *
 * `entries` and `runTmux` are injectable for testing; both default to the live
 * store and a real `execFile`-backed runner.
 */
export async function getTmuxWindows(
  entries: ActiveSessionEntry[] = getActiveSessionEntries(),
  runTmux: TmuxRunner = runTmuxListPanes,
): Promise<TmuxWindow[]> {
  const bySocket = new Map<string, ActiveSessionEntry[]>();
  for (const entry of entries) {
    if (!entry.tmuxPane || !entry.tmuxServerSocket) continue;
    const list = bySocket.get(entry.tmuxServerSocket);
    if (list) list.push(entry);
    else bySocket.set(entry.tmuxServerSocket, [entry]);
  }

  const windows: TmuxWindow[] = [];
  const seenPanes = new Set<string>();

  for (const [socket, socketEntries] of bySocket) {
    let panes: Map<string, TmuxPane>;
    try {
      panes = parseTmuxPanes(await runTmux(socket));
    } catch {
      continue;
    }

    for (const entry of socketEntries) {
      const pane = panes.get(entry.tmuxPane);
      if (!pane) continue;
      // One window per pane: multiple store entries can point at the same pane
      // (grouped sessions, resume churn).
      const paneKey = `${socket}\t${pane.paneId}`;
      if (seenPanes.has(paneKey)) continue;
      seenPanes.add(paneKey);
      windows.push({
        sessionId: entry.sessionId,
        projectName: entry.cwd ? basename(entry.cwd) : "",
        windowIndex: pane.windowIndex,
        windowName: pane.windowName,
        windowActive: pane.windowActive,
        tmuxPane: pane.paneId,
        socket,
      });
    }
  }

  windows.sort((a, b) => a.windowIndex - b.windowIndex);
  return windows;
}
