import type {HerdrPaneLink} from "../herdr/panes";
import type {TmuxSessionPane} from "./session-panes";

/**
 * A tmux session pane in the pane-link shape every pane consumer reads. tmux
 * has no agent status or revisions; its session is the workspace and its
 * window the tab. The terminal id carries the server socket because `%N` pane
 * ids repeat across tmux servers.
 */
export function toTmuxPaneLink({sessionId, cwd, pane, via}: TmuxSessionPane): HerdrPaneLink {
	return {
		host: "tmux",
		paneId: pane.paneId,
		terminalId: `tmux:${pane.socketPath}:${pane.paneId}`,
		workspaceId: pane.sessionName,
		tabId: `${pane.sessionName}:${String(pane.windowIndex)}`,
		focused: pane.windowActive && pane.paneActive,
		cwd,
		foregroundCwd: pane.currentPath === "" ? null : pane.currentPath,
		agentStatus: "unknown",
		agent: "claude",
		terminalTitle: pane.windowName === "" ? null : pane.windowName,
		agentSessionId: null,
		revision: 0,
		sessionId,
		via,
	};
}
