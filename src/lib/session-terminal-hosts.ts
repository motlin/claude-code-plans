import {getActiveSessionEntries, type ActiveSessionEntry} from "./active-session-store";
import {herdrPaneTable, type HerdrPaneReader} from "./herdr/pane-table";
import {filterIndexedSessions, linkHerdrPanes, type IndexedSessionFilter} from "./herdr/panes";
import {terminalHostLabel} from "./session-environment";
import {tmuxPaneTable, type TmuxPaneTable} from "./tmux/pane-table";

export interface SessionTerminalHostSources {
	herdr: HerdrPaneReader;
	tmux: Pick<TmuxPaneTable, "current">;
	entries: () => ActiveSessionEntry[];
	indexedSessionFilter: IndexedSessionFilter;
}

const defaultSources: SessionTerminalHostSources = {
	herdr: herdrPaneTable,
	tmux: tmuxPaneTable,
	entries: getActiveSessionEntries,
	indexedSessionFilter: filterIndexedSessions,
};

/**
 * Each session's terminal host label (see `terminalHostLabel`), for the
 * session list rows. Read from the pane tables the herdr event bridges and
 * the tmux poller keep in memory, never herdr or tmux themselves: while a
 * table is not current its sessions read as Local, and the next pane event
 * refetches the lists.
 */
export function getSessionTerminalHosts(
	sources: SessionTerminalHostSources = defaultSources,
): ReadonlyMap<string, string> {
	const labels = new Map<string, string>();
	const herdr = sources.herdr.current();
	if (herdr !== null) {
		for (const link of linkHerdrPanes(herdr, sources.entries(), sources.indexedSessionFilter)) {
			if (!labels.has(link.sessionId)) labels.set(link.sessionId, terminalHostLabel(link));
		}
	}
	for (const {sessionId, pane} of sources.tmux.current() ?? []) {
		if (!labels.has(sessionId))
			labels.set(
				sessionId,
				terminalHostLabel({host: "tmux", paneId: pane.paneId, workspaceId: pane.sessionName}),
			);
	}
	return labels;
}
