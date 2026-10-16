import {basename} from "node:path";
import type {TerminalPlacementBase, TerminalPlacementProvider} from "./terminal-placements";
import {defaultTmuxSessionPaneSources, getTmuxSessionPanes, type TmuxSessionPaneSources} from "./tmux/session-panes";

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

export interface TmuxTerminalPlacement extends TerminalPlacementBase {
	provider: "tmux";
	tmuxWindow: TmuxWindow;
}

/** Events come from the 2 s `list-panes` poll in `tmux/pane-events.ts`. */
const TMUX_CAPABILITIES = {
	supportsWrite: false,
	supportsEvents: true,
	supportsObserve: false,
};

/**
 * The live tmux windows running Claude sessions, from `getTmuxSessionPanes`
 * (hook `TMUX_PANE`, else the session pid's process tree), in window order.
 */
export async function getTmuxWindows(
	sources: TmuxSessionPaneSources = defaultTmuxSessionPaneSources,
): Promise<TmuxWindow[]> {
	const sessionPanes = await getTmuxSessionPanes(sources);
	return sessionPanes
		.map(({sessionId, cwd, pane}) => ({
			sessionId,
			projectName: cwd ? basename(cwd) : "",
			windowIndex: pane.windowIndex,
			windowName: pane.windowName,
			windowActive: pane.windowActive,
			tmuxPane: pane.paneId,
			socket: pane.socketPath,
		}))
		.toSorted((a, b) => a.windowIndex - b.windowIndex);
}

async function getTmuxPlacements(sources: TmuxSessionPaneSources): Promise<TmuxTerminalPlacement[]> {
	const windows = await getTmuxWindows(sources);
	return windows.map((window) => ({
		provider: "tmux",
		sessionId: window.sessionId,
		displayName: window.windowName,
		active: window.windowActive,
		paneHandle: window.tmuxPane,
		scopeHandle: window.socket,
		capabilities: TMUX_CAPABILITIES,
		tmuxWindow: window,
	}));
}

export function createTmuxPlacementProvider(
	sources: TmuxSessionPaneSources = defaultTmuxSessionPaneSources,
): TerminalPlacementProvider {
	return {
		id: "tmux",
		capabilities: TMUX_CAPABILITIES,
		getPlacements: async () => getTmuxPlacements(sources),
	};
}
