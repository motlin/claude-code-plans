import {HERDR_EVENTS} from "../hook-events";
import {hmrDispose, hmrPersist} from "../hmr-persist";
import {broadcastTyped} from "../sse-broadcast";
import {createHerdrPaneDiffer} from "../herdr/pane-differ";
import {toTmuxPaneLink} from "./pane-links";
import {getTmuxSessionPanes, type TmuxSessionPane} from "./session-panes";

/** tmux pushes nothing to a plain client, so ccp polls `list-panes` this often. */
export const TMUX_PANE_POLL_INTERVAL_MS = 2000;

export interface TmuxPaneEvent {
	type: string;
	data: Record<string, unknown>;
}

interface TrackedPane {
	pane: TmuxSessionPane;
	signature: string;
	revision: number;
}

/**
 * The differ's identity for a pane. `%N` ids repeat across tmux servers and
 * restart from `%0` with a new server, so the socket and pane pid are part of
 * it: a reused id is a new pane, never a tombstoned one coming back.
 */
function paneKey({pane}: TmuxSessionPane): string {
	return `${pane.socketPath}\0${pane.paneId}\0${String(pane.panePid)}`;
}

/**
 * Turns successive `list-panes` polls into the pane created / closed / updated
 * events herdr pushes, through the same pane-differ. tmux has no revisions, so
 * each change to a pane's link bumps a local one. The first poll only seeds.
 */
export function createTmuxPaneEventTracker(): {poll: (panes: readonly TmuxSessionPane[]) => TmuxPaneEvent[]} {
	const differ = createHerdrPaneDiffer();
	let tracked = new Map<string, TrackedPane>();
	let seeded = false;

	return {
		poll(panes) {
			const next = new Map<string, TrackedPane>();
			const events: TmuxPaneEvent[] = [];
			for (const pane of panes) {
				const key = paneKey(pane);
				const link = toTmuxPaneLink(pane);
				const signature = JSON.stringify(link);
				const previous = tracked.get(key);
				if (previous === undefined) {
					next.set(key, {pane, signature, revision: 1});
					if (!seeded) differ.seedKnownPanes([{paneId: key, revision: 1}]);
					else if (differ.recordCreated({paneId: key, revision: 1})) {
						events.push({type: HERDR_EVENTS.PANE_CREATED, data: {host: "tmux", pane: link}});
					}
					continue;
				}
				const revision = previous.signature === signature ? previous.revision : previous.revision + 1;
				next.set(key, {pane, signature, revision});
				if (revision !== previous.revision && differ.recordUpdated({paneId: key, revision})) {
					events.push({type: HERDR_EVENTS.PANE_UPDATED, data: {host: "tmux", pane: link}});
				}
			}
			for (const [key, {pane}] of tracked) {
				if (next.has(key) || !differ.recordClosed(key)) continue;
				const link = toTmuxPaneLink(pane);
				events.push({
					type: HERDR_EVENTS.PANE_CLOSED,
					data: {host: "tmux", pane_id: link.paneId, terminal_id: link.terminalId},
				});
			}
			tracked = next;
			seeded = true;
			return events;
		},
	};
}

type Timer = ReturnType<typeof setTimeout>;

export interface TmuxPaneEventPollerDependencies {
	listSessionPanes: () => Promise<TmuxSessionPane[]>;
	broadcast: (type: string, data: Record<string, unknown>) => void;
	schedule: (callback: () => void, delayMs: number) => Timer | number;
	cancel: (timer: Timer | number) => void;
}

/** Poll tmux every 2 s and broadcast its pane events; returns the stop. Polls never overlap. */
export function createTmuxPaneEventPoller(dependencies: TmuxPaneEventPollerDependencies): () => void {
	const tracker = createTmuxPaneEventTracker();
	let stopped = false;
	const isStopped = (): boolean => stopped;
	let timer: Timer | number | null = null;

	const poll = async (): Promise<void> => {
		timer = null;
		if (stopped) return;
		try {
			const panes = await dependencies.listSessionPanes();
			if (isStopped()) return;
			for (const event of tracker.poll(panes)) dependencies.broadcast(event.type, event.data);
		} catch (error) {
			console.error("tmux pane poll failed", error);
		}
		if (isStopped()) return;
		timer = dependencies.schedule(() => void poll(), TMUX_PANE_POLL_INTERVAL_MS);
	};

	timer = dependencies.schedule(() => void poll(), 0);

	return () => {
		if (stopped) return;
		stopped = true;
		if (timer !== null) dependencies.cancel(timer);
		timer = null;
	};
}

const defaultDependencies: TmuxPaneEventPollerDependencies = {
	listSessionPanes: async () => getTmuxSessionPanes(),
	broadcast: broadcastTyped,
	schedule: setTimeout,
	cancel: (timer) => {
		clearTimeout(timer);
	},
};

const pollerState = hmrPersist<{stop: (() => void) | null}>("tmuxPaneEventPoller", () => ({stop: null}));

/** Start the single process-wide tmux pane-event poller. */
export function startTmuxPaneEvents(): () => void {
	if (pollerState.stop) return pollerState.stop;
	const stopPoller = createTmuxPaneEventPoller(defaultDependencies);
	const stop = (): void => {
		stopPoller();
		if (pollerState.stop === stop) pollerState.stop = null;
	};
	pollerState.stop = stop;
	return stop;
}

hmrDispose(() => {
	pollerState.stop?.();
});
