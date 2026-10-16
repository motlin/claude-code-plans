import {describe, expect, it} from "vite-plus/test";
import {HERDR_EVENTS} from "../src/lib/hook-events";
import {toTmuxPaneLink} from "../src/lib/tmux/pane-links";
import {
	createTmuxPaneEventPoller,
	createTmuxPaneEventTracker,
	TMUX_PANE_POLL_INTERVAL_MS,
	type TmuxPaneEventPollerDependencies,
} from "../src/lib/tmux/pane-events";
import type {TmuxListedPane, TmuxSessionPane} from "../src/lib/tmux/session-panes";

const SOCKET = "/private/tmp/tmux-501/default";

function sessionPane(
	sessionId: string,
	overrides: Partial<TmuxListedPane> & Pick<TmuxListedPane, "paneId" | "panePid">,
): TmuxSessionPane {
	return {
		sessionId,
		cwd: "/tmp/test/alice-project",
		via: "env",
		pane: {
			socketPath: SOCKET,
			sessionName: "main",
			windowIndex: 1,
			windowName: "claude",
			windowActive: false,
			paneActive: true,
			currentPath: "/tmp/test/alice-project",
			...overrides,
		},
	};
}

const alice = sessionPane("session-test-alice", {paneId: "%1", panePid: 101});
const bob = sessionPane("session-test-bob", {paneId: "%2", panePid: 102});

describe("tmux pane event tracker", () => {
	it("seeds from the first poll without announcing the panes that already exist", () => {
		const tracker = createTmuxPaneEventTracker();

		expect(tracker.poll([alice, bob])).toStrictEqual([]);
	});

	it("announces a pane that appears between polls as created", () => {
		const tracker = createTmuxPaneEventTracker();
		tracker.poll([alice]);

		expect(tracker.poll([alice, bob])).toStrictEqual([
			{type: HERDR_EVENTS.PANE_CREATED, data: {host: "tmux", pane: toTmuxPaneLink(bob)}},
		]);
	});

	it("announces a pane that disappears between polls as closed, once", () => {
		const tracker = createTmuxPaneEventTracker();
		tracker.poll([alice, bob]);

		expect(tracker.poll([alice])).toStrictEqual([
			{
				type: HERDR_EVENTS.PANE_CLOSED,
				data: {host: "tmux", pane_id: "%2", terminal_id: `tmux:${SOCKET}:%2`},
			},
		]);
		expect(tracker.poll([alice])).toStrictEqual([]);
	});

	it("announces a changed pane as updated, and stays quiet while it is unchanged", () => {
		const tracker = createTmuxPaneEventTracker();
		tracker.poll([alice]);
		const renamed = sessionPane("session-test-alice", {paneId: "%1", panePid: 101, windowName: "renamed"});

		expect(tracker.poll([renamed])).toStrictEqual([
			{type: HERDR_EVENTS.PANE_UPDATED, data: {host: "tmux", pane: toTmuxPaneLink(renamed)}},
		]);
		expect(tracker.poll([renamed])).toStrictEqual([]);
	});

	it("announces a reused pane id from a restarted tmux server as a new pane", () => {
		const tracker = createTmuxPaneEventTracker();
		tracker.poll([alice]);
		tracker.poll([]);
		const reborn = sessionPane("session-test-carol", {paneId: "%1", panePid: 301});

		expect(tracker.poll([reborn])).toStrictEqual([
			{type: HERDR_EVENTS.PANE_CREATED, data: {host: "tmux", pane: toTmuxPaneLink(reborn)}},
		]);
	});
});

describe("tmux pane event poller", () => {
	function harness(polls: TmuxSessionPane[][]) {
		const broadcasts: Array<{type: string; data: Record<string, unknown>}> = [];
		const delays: number[] = [];
		const pending: Array<() => void> = [];
		let cancelled = 0;
		const dependencies: TmuxPaneEventPollerDependencies = {
			listSessionPanes: async () => Promise.resolve(polls.shift() ?? []),
			broadcast: (type, data) => {
				broadcasts.push({type, data});
			},
			schedule: (callback, delayMs) => {
				delays.push(delayMs);
				pending.push(callback);
				return pending.length;
			},
			cancel: () => {
				cancelled += 1;
			},
		};
		const runNext = async (): Promise<void> => {
			pending.shift()?.();
			await new Promise((resolve) => {
				setImmediate(resolve);
			});
		};
		return {dependencies, broadcasts, delays, runNext, cancelledCount: () => cancelled};
	}

	it("polls every 2 s and broadcasts each poll's pane events over SSE", async () => {
		const {dependencies, broadcasts, delays, runNext} = harness([[alice], [alice, bob], [bob]]);
		const stop = createTmuxPaneEventPoller(dependencies);
		await runNext();
		await runNext();
		await runNext();
		stop();

		expect({broadcasts, delays}).toStrictEqual({
			broadcasts: [
				{type: HERDR_EVENTS.PANE_CREATED, data: {host: "tmux", pane: toTmuxPaneLink(bob)}},
				{
					type: HERDR_EVENTS.PANE_CLOSED,
					data: {host: "tmux", pane_id: "%1", terminal_id: `tmux:${SOCKET}:%1`},
				},
			],
			delays: [0, TMUX_PANE_POLL_INTERVAL_MS, TMUX_PANE_POLL_INTERVAL_MS, TMUX_PANE_POLL_INTERVAL_MS],
		});
	});

	it("stops scheduling polls once stopped", async () => {
		const {dependencies, delays, runNext, cancelledCount} = harness([[alice]]);
		const stop = createTmuxPaneEventPoller(dependencies);
		stop();
		await runNext();

		expect({delays, cancelled: cancelledCount()}).toStrictEqual({delays: [0], cancelled: 1});
	});
});
