import {hmrPersist} from "../hmr-persist";
import type {TmuxSessionPane} from "./session-panes";

/**
 * How long a poll's panes stay current. Polls run every 2 s and each can take
 * a couple of seconds of tmux and ps, so a table older than this means the
 * poller has stalled and readers should ask tmux themselves.
 */
export const TMUX_PANE_TABLE_MAX_AGE_MS = 10_000;

/**
 * Process-wide tmux session panes kept current by the pane-event poller, so
 * request handlers read them from memory instead of running `tmux list-panes`
 * and `ps` per request. While it is not current, readers ask tmux directly.
 */
export interface TmuxPaneTable {
	/** A poll's panes, current for `TMUX_PANE_TABLE_MAX_AGE_MS`. */
	update(panes: readonly TmuxSessionPane[]): void;
	/** Panes that stay current until the next update or invalidate, as while tmux is not installed. */
	hold(panes: readonly TmuxSessionPane[]): void;
	invalidate(): void;
	/** The current panes, or `null` when the table is not tracking tmux right now. */
	current(): readonly TmuxSessionPane[] | null;
}

export function createTmuxPaneTable(now: () => number = Date.now): TmuxPaneTable {
	let state: {panes: readonly TmuxSessionPane[]; expiresAt: number} | null = null;
	return {
		update(panes) {
			state = {panes, expiresAt: now() + TMUX_PANE_TABLE_MAX_AGE_MS};
		},
		hold(panes) {
			state = {panes, expiresAt: Number.POSITIVE_INFINITY};
		},
		invalidate() {
			state = null;
		},
		current() {
			if (state === null || now() > state.expiresAt) return null;
			return state.panes;
		},
	};
}

export const tmuxPaneTable: TmuxPaneTable = hmrPersist("tmuxPaneTable", () => createTmuxPaneTable());
