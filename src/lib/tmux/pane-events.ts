import {getActiveSessionEntries} from "../active-session-store";
import {terminalHostSetting} from "../config";
import {HERDR_EVENTS} from "../hook-events";
import {hmrDispose, hmrPersist} from "../hmr-persist";
import {broadcastTyped} from "../sse-broadcast";
import {createHerdrPaneDiffer} from "../herdr/pane-differ";
import {toTmuxPaneLink} from "./pane-links";
import {tmuxPaneTable, type TmuxPaneTable} from "./pane-table";
import {pollTmuxSessionPanes, TMUX_NOT_INSTALLED, type TmuxSessionPane} from "./session-panes";

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
	listSessionPanes: () => Promise<TmuxSessionPane[] | typeof TMUX_NOT_INSTALLED>;
	broadcast: (type: string, data: Record<string, unknown>) => void;
	/** Kept current with each poll's panes for request handlers. */
	table: TmuxPaneTable;
	/**
	 * A cheap, process-free reading of what could make tmux appear: the
	 * Terminal host setting and the hook-reported tmux panes. While tmux is not
	 * installed the poller only polls again once this changes.
	 */
	wakeSignature: () => string;
	schedule: (callback: () => void, delayMs: number) => Timer | number;
	cancel: (timer: Timer | number) => void;
}

/**
 * Poll tmux every 2 s, broadcast its pane events and keep the pane table
 * current; returns the stop. Polls never overlap. A missing tmux binary puts
 * the poller to sleep, quietly and with no table expiry, until the wake
 * signature changes.
 */
export function createTmuxPaneEventPoller(dependencies: TmuxPaneEventPollerDependencies): () => void {
	const tracker = createTmuxPaneEventTracker();
	const {table} = dependencies;
	let stopped = false;
	const isStopped = (): boolean => stopped;
	let timer: Timer | number | null = null;
	let dormantSignature: string | null = null;

	const poll = async (): Promise<void> => {
		timer = null;
		if (stopped) return;
		if (dormantSignature === null || dependencies.wakeSignature() !== dormantSignature) {
			dormantSignature = null;
			try {
				const panes = await dependencies.listSessionPanes();
				if (isStopped()) return;
				if (panes === TMUX_NOT_INSTALLED) {
					dormantSignature = dependencies.wakeSignature();
					table.hold([]);
				} else {
					table.update(panes);
					for (const event of tracker.poll(panes)) dependencies.broadcast(event.type, event.data);
				}
			} catch (error) {
				table.invalidate();
				console.error("tmux pane poll failed", error);
			}
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
		table.invalidate();
	};
}

function tmuxWakeSignature(): string {
	const hookPanes = getActiveSessionEntries()
		.filter((entry) => entry.tmuxPane !== "")
		.map((entry) => `${entry.sessionId}:${entry.tmuxServerSocket}:${entry.tmuxPane}`)
		.toSorted();
	return [terminalHostSetting(), ...hookPanes].join("\n");
}

const defaultDependencies: TmuxPaneEventPollerDependencies = {
	listSessionPanes: async () => pollTmuxSessionPanes(),
	broadcast: broadcastTyped,
	table: tmuxPaneTable,
	wakeSignature: tmuxWakeSignature,
	schedule: setTimeout,
	cancel: (timer) => {
		clearTimeout(timer);
	},
};

const pollerState = hmrPersist<{stop: (() => void) | null}>("tmuxPaneEventPoller", () => ({stop: null}));
/** The poller this module instance started; other dev instances share `pollerState` but must not stop it. */
let startedHere: (() => void) | null = null;

/** Start the single process-wide tmux pane-event poller. */
export function startTmuxPaneEvents(): () => void {
	if (pollerState.stop) return pollerState.stop;
	const stopPoller = createTmuxPaneEventPoller(defaultDependencies);
	const stop = (): void => {
		stopPoller();
		if (pollerState.stop === stop) pollerState.stop = null;
	};
	pollerState.stop = stop;
	startedHere = stop;
	return stop;
}

hmrDispose(() => {
	startedHere?.();
});
