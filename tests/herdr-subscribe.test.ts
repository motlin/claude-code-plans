import {EventEmitter} from "node:events";
import type {Interface as ReadlineInterface} from "node:readline";
import type {Socket} from "node:net";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {HERDR_EVENTS} from "../src/lib/hook-events";
import {createHerdrPaneTable, type HerdrPaneState} from "../src/lib/herdr/pane-table";
import type {PaneRevision} from "../src/lib/herdr/pane-differ";
import {__testing} from "../src/lib/herdr/subscribe";

class FakeSocket extends EventEmitter {
	readonly writes: string[] = [];
	destroyedByBridge = false;

	write(value: string): boolean {
		this.writes.push(value);
		return true;
	}

	destroy(): this {
		this.destroyedByBridge = true;
		return this;
	}
}

class FakeLineReader extends EventEmitter {
	closed = false;

	send(message: object): void {
		this.emit("line", JSON.stringify(message));
	}

	close(): void {
		this.closed = true;
	}
}

interface Broadcast {
	type: string;
	data: Record<string, unknown>;
}

async function available() {
	return Promise.resolve({
		available: true as const,
		socketPath: "/test/herdr.sock",
		version: "0.8.0-test",
		protocol: 100,
	});
}

async function unavailable() {
	return Promise.resolve({
		available: false as const,
		socketPath: "/test/herdr.sock",
		reason: "no-socket" as const,
	});
}

function wirePane(paneId: string, revision: number, agentStatus = "idle"): HerdrPaneState["panes"][number] {
	const workspaceId = paneId.split(":")[0] ?? paneId;
	return {
		pane_id: paneId,
		terminal_id: `terminal-${paneId}`,
		workspace_id: workspaceId,
		tab_id: `${workspaceId}:t1`,
		focused: false,
		agent: "claude",
		agent_status: agentStatus,
		revision,
	};
}

function paneState(panes: PaneRevision[]): HerdrPaneState {
	return {workspaces: [], panes: panes.map(({paneId, revision}) => wirePane(paneId, revision ?? 0))};
}

type BridgeDependencies = Parameters<typeof __testing.createBridge>[0];
type Tracker = BridgeDependencies["viewedStateTracker"];

async function flushPromises(): Promise<void> {
	for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function viewedStateTracker() {
	return {
		syncPanes: vi.fn<Tracker["syncPanes"]>(async () => {}),
		handleStatusEvent: vi.fn<Tracker["handleStatusEvent"]>(async () => {}),
	};
}

describe("herdr event bridge", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("retries unavailable probes with capped exponential backoff and recovers", async () => {
		const sockets: FakeSocket[] = [];
		const lineReaders: FakeLineReader[] = [];
		const scheduledDelays: number[] = [];
		const getPanes = vi.fn<BridgeDependencies["getPanes"]>(async () => Promise.resolve([]));
		const broadcasts: Broadcast[] = [];
		const expectedBackoffs = [250, 500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000];
		let probeAttempts = 0;
		const probe = vi.fn<BridgeDependencies["probe"]>(async () => {
			probeAttempts += 1;
			return probeAttempts <= expectedBackoffs.length ? unavailable() : available();
		});

		const stop = __testing.createBridge({
			probe,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => {
				const lineReader = new FakeLineReader();
				lineReaders.push(lineReader);
				return lineReader as unknown as ReadlineInterface;
			},
			getSnapshot: async () => Promise.resolve(paneState([{paneId: "workspace-100:pane-100", revision: 0}])),
			getPanes,
			paneTable: createHerdrPaneTable(),
			broadcast: (type, data) => broadcasts.push({type, data}),
			schedule: (callback, delayMs) => {
				scheduledDelays.push(delayMs);
				return setTimeout(callback, delayMs);
			},
			cancel: clearTimeout,
			viewedStateTracker: viewedStateTracker(),
		});
		await flushPromises();

		for (const delayMs of expectedBackoffs) await vi.advanceTimersByTimeAsync(delayMs);

		expect({
			probeCalls: probe.mock.calls,
			scheduledDelays,
			socketCount: sockets.length,
			getPanesCalls: getPanes.mock.calls,
			broadcasts,
		}).toStrictEqual({
			probeCalls: [[], [], [], [], [], [], [], [], []],
			scheduledDelays: expectedBackoffs,
			socketCount: 1,
			getPanesCalls: [[]],
			broadcasts: [{type: HERDR_EVENTS.PANES_SNAPSHOT, data: {panes: []}}],
		});
		stop();
	});

	it("cancels an unavailable probe retry during teardown", async () => {
		const scheduledDelays: number[] = [];
		const probe = vi.fn<BridgeDependencies["probe"]>(unavailable);
		const cancel = vi.fn<BridgeDependencies["cancel"]>((timer) => {
			clearTimeout(timer);
		});

		const stop = __testing.createBridge({
			probe,
			connect: () => new FakeSocket() as unknown as Socket,
			createLineReader: () => new FakeLineReader() as unknown as ReadlineInterface,
			getSnapshot: async () => Promise.resolve(paneState([{paneId: "workspace-100:pane-100", revision: 0}])),
			getPanes: async () => Promise.resolve([]),
			paneTable: createHerdrPaneTable(),
			broadcast: () => {},
			schedule: (callback, delayMs) => {
				scheduledDelays.push(delayMs);
				return setTimeout(callback, delayMs);
			},
			cancel,
			viewedStateTracker: viewedStateTracker(),
		});
		await flushPromises();

		stop();
		await vi.advanceTimersByTimeAsync(10_000);

		expect({
			probeCalls: probe.mock.calls,
			scheduledDelays,
			cancelCallCount: cancel.mock.calls.length,
		}).toStrictEqual({probeCalls: [[]], scheduledDelays: [250], cancelCallCount: 1});
	});

	it("uses dot subscriptions, maps snake-case pushes, and coalesces snapshot resyncs", async () => {
		const sockets: FakeSocket[] = [];
		const lineReaders: FakeLineReader[] = [];
		const broadcasts: Broadcast[] = [];
		const getPanes = vi.fn<BridgeDependencies["getPanes"]>(async () => Promise.resolve([]));
		const tracker = viewedStateTracker();
		const stop = __testing.createBridge({
			probe: available,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => {
				const lineReader = new FakeLineReader();
				lineReaders.push(lineReader);
				return lineReader as unknown as ReadlineInterface;
			},
			getSnapshot: async () => Promise.resolve(paneState([{paneId: "workspace-100:pane-100", revision: 0}])),
			getPanes,
			paneTable: createHerdrPaneTable(),
			broadcast: (type, data) => broadcasts.push({type, data}),
			schedule: setTimeout,
			cancel: clearTimeout,
			viewedStateTracker: tracker,
		});
		await flushPromises();

		const socket = sockets[0]!;
		const lineReader = lineReaders[0]!;
		socket.emit("connect");
		await flushPromises();
		lineReader.send({id: "ccp:sub", result: {type: "subscription_started"}});
		// Replayed create for the already-subscribed pane and a close for an
		// unknown pane are both deduplicated away.
		lineReader.send({event: "pane_created", data: {pane_id: "workspace-100:pane-100"}});
		lineReader.send({event: "pane_closed", data: {pane_id: "workspace-100:pane-200"}});
		lineReader.send({event: "pane_updated", data: {pane_id: "workspace-100:pane-300"}});
		lineReader.send({event: "pane_moved", data: {pane_id: "workspace-100:pane-400"}});
		lineReader.send({event: "pane_exited", data: {pane_id: "workspace-100:pane-500"}});
		lineReader.send({
			event: "pane_agent_detected",
			data: {pane_id: "workspace-100:pane-600"},
		});
		lineReader.send({
			event: "pane_agent_status_changed",
			data: {pane_id: "workspace-100:pane-700"},
		});
		lineReader.send({event: "pane_focused", data: {pane_id: "workspace-100:pane-800"}});
		await flushPromises();

		expect({
			writes: socket.writes,
			broadcasts,
			getPanesCalls: getPanes.mock.calls,
			syncedPanes: tracker.syncPanes.mock.calls,
			statusEvents: tracker.handleStatusEvent.mock.calls,
		}).toStrictEqual({
			writes: [
				'{"id":"ccp:sub","method":"events.subscribe","params":{"subscriptions":[{"type":"pane.created"},{"type":"pane.closed"},{"type":"pane.updated"},{"type":"pane.moved"},{"type":"pane.exited"},{"type":"pane.agent_detected"},{"type":"pane.agent_status_changed","pane_id":"workspace-100:pane-100"}]}}\n',
			],
			broadcasts: [
				{type: HERDR_EVENTS.PANES_SNAPSHOT, data: {panes: []}},
				{
					type: HERDR_EVENTS.PANE_UPDATED,
					data: {pane_id: "workspace-100:pane-300"},
				},
				{type: HERDR_EVENTS.PANE_MOVED, data: {pane_id: "workspace-100:pane-400"}},
				{type: HERDR_EVENTS.PANE_EXITED, data: {pane_id: "workspace-100:pane-500"}},
				{
					type: HERDR_EVENTS.PANE_AGENT_DETECTED,
					data: {pane_id: "workspace-100:pane-600"},
				},
				{
					type: HERDR_EVENTS.PANE_AGENT_STATUS_CHANGED,
					data: {pane_id: "workspace-100:pane-700"},
				},
			],
			getPanesCalls: [[]],
			syncedPanes: [[[]]],
			statusEvents: [[{pane_id: "workspace-100:pane-700"}]],
		});

		await vi.advanceTimersByTimeAsync(249);
		expect(getPanes.mock.calls).toStrictEqual([[]]);
		await vi.advanceTimersByTimeAsync(1);
		// The coalesced resync runs but its payload is unchanged, so the
		// identical snapshot is not rebroadcast.
		expect({getPanesCalls: getPanes.mock.calls, lastBroadcast: broadcasts.at(-1)}).toStrictEqual({
			getPanesCalls: [[], []],
			lastBroadcast: {
				type: HERDR_EVENTS.PANE_AGENT_STATUS_CHANGED,
				data: {pane_id: "workspace-100:pane-700"},
			},
		});
		stop();
	});

	it("reconnects with capped exponential backoff and resets after a connection", async () => {
		const sockets: FakeSocket[] = [];
		const lineReaders: FakeLineReader[] = [];
		const scheduledDelays: number[] = [];
		const stop = __testing.createBridge({
			probe: available,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => {
				const lineReader = new FakeLineReader();
				lineReaders.push(lineReader);
				return lineReader as unknown as ReadlineInterface;
			},
			getSnapshot: async () => Promise.resolve(paneState([{paneId: "workspace-100:pane-100", revision: 0}])),
			getPanes: async () => Promise.resolve([]),
			paneTable: createHerdrPaneTable(),
			broadcast: () => {},
			schedule: (callback, delayMs) => {
				scheduledDelays.push(delayMs);
				return setTimeout(callback, delayMs);
			},
			cancel: clearTimeout,
			viewedStateTracker: viewedStateTracker(),
		});
		await flushPromises();

		const expectedBackoffs = [250, 500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000];
		for (const delayMs of expectedBackoffs) {
			sockets.at(-1)!.emit("error", new Error("test daemon unavailable"));
			await vi.advanceTimersByTimeAsync(delayMs);
		}

		const connectedSocket = sockets.at(-1)!;
		connectedSocket.emit("connect");
		await flushPromises();
		connectedSocket.emit("close");

		expect({
			scheduledDelays,
			socketCount: sockets.length,
			writes: connectedSocket.writes,
		}).toStrictEqual({
			scheduledDelays: [...expectedBackoffs, 250],
			socketCount: 9,
			writes: [__testing.subscriptionRequest(["workspace-100:pane-100"])],
		});
		stop();
		await vi.advanceTimersByTimeAsync(250);
		expect(sockets.length).toBe(9);
	});

	it("treats a second socket error such as a write EPIPE as the same quiet disconnect", async () => {
		const sockets: FakeSocket[] = [];
		const scheduledDelays: number[] = [];
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const stop = __testing.createBridge({
			probe: available,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => new FakeLineReader() as unknown as ReadlineInterface,
			getSnapshot: async () => Promise.resolve(paneState([{paneId: "workspace-100:pane-100", revision: 0}])),
			getPanes: async () => Promise.resolve([]),
			paneTable: createHerdrPaneTable(),
			broadcast: () => {},
			schedule: (callback, delayMs) => {
				scheduledDelays.push(delayMs);
				return setTimeout(callback, delayMs);
			},
			cancel: clearTimeout,
			viewedStateTracker: viewedStateTracker(),
		});
		await flushPromises();
		const socket = sockets[0]!;
		socket.emit("connect");
		await flushPromises();

		const emitErrors = () => {
			socket.emit("error", Object.assign(new Error("read ECONNRESET"), {code: "ECONNRESET"}));
			socket.emit("error", Object.assign(new Error("write EPIPE"), {code: "EPIPE"}));
			socket.emit("close");
		};

		expect(emitErrors).not.toThrow();
		expect({
			scheduledDelays,
			destroyedByBridge: socket.destroyedByBridge,
			consoleErrorCalls: consoleError.mock.calls,
		}).toStrictEqual({
			scheduledDelays: [250],
			destroyedByBridge: true,
			consoleErrorCalls: [],
		});
		consoleError.mockRestore();
		stop();
	});

	it("destroys the active socket and cancels pending resync during teardown", async () => {
		const sockets: FakeSocket[] = [];
		const lineReaders: FakeLineReader[] = [];
		const getPanes = vi.fn<BridgeDependencies["getPanes"]>(async () => Promise.resolve([]));
		const stop = __testing.createBridge({
			probe: available,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => {
				const lineReader = new FakeLineReader();
				lineReaders.push(lineReader);
				return lineReader as unknown as ReadlineInterface;
			},
			getSnapshot: async () => Promise.resolve(paneState([{paneId: "workspace-100:pane-100", revision: 0}])),
			getPanes,
			paneTable: createHerdrPaneTable(),
			broadcast: () => {},
			schedule: setTimeout,
			cancel: clearTimeout,
			viewedStateTracker: viewedStateTracker(),
		});
		await flushPromises();
		const socket = sockets[0]!;
		const lineReader = lineReaders[0]!;
		socket.emit("connect");
		await flushPromises();
		lineReader.send({event: "pane_updated", data: {pane_id: "workspace-100:pane-100"}});
		await flushPromises();

		stop();
		await vi.advanceTimersByTimeAsync(250);

		expect({
			destroyedByBridge: socket.destroyedByBridge,
			getPanesCalls: getPanes.mock.calls,
			lineReaderClosed: lineReader.closed,
		}).toStrictEqual({destroyedByBridge: true, getPanesCalls: [[]], lineReaderClosed: true});
	});

	it("announces a new pane once even though herdr replays its create on every resubscribe", async () => {
		const sockets: FakeSocket[] = [];
		const lineReaders: FakeLineReader[] = [];
		const broadcasts: Broadcast[] = [];
		let snapshotCalls = 0;
		const replayedCreate = {
			event: "pane_created",
			data: {pane: {pane_id: "wE:p17", revision: 0}},
		};
		const stop = __testing.createBridge({
			probe: available,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => {
				const lineReader = new FakeLineReader();
				lineReaders.push(lineReader);
				return lineReader as unknown as ReadlineInterface;
			},
			getSnapshot: async () => {
				snapshotCalls += 1;
				return Promise.resolve(paneState(snapshotCalls === 1 ? [] : [{paneId: "wE:p17", revision: 0}]));
			},
			getPanes: async () => Promise.resolve([]),
			paneTable: createHerdrPaneTable(),
			broadcast: (type, data) => broadcasts.push({type, data}),
			schedule: setTimeout,
			cancel: clearTimeout,
			viewedStateTracker: viewedStateTracker(),
		});
		await flushPromises();
		sockets[0]!.emit("connect");
		await flushPromises();

		// A genuinely new pane: broadcast once and reconnect to subscribe to it.
		lineReaders[0]!.send(replayedCreate);
		await flushPromises();
		await vi.advanceTimersByTimeAsync(250);
		sockets[1]!.emit("connect");
		await flushPromises();

		// herdr replays the same create on the fresh subscription, forever.
		for (let replay = 0; replay < 5; replay += 1) lineReaders[1]!.send(replayedCreate);
		await flushPromises();
		await vi.advanceTimersByTimeAsync(1_000);

		expect({
			createBroadcasts: broadcasts.filter((b) => b.type === HERDR_EVENTS.PANE_CREATED),
			snapshotBroadcasts: broadcasts.filter((b) => b.type === HERDR_EVENTS.PANES_SNAPSHOT),
			socketCount: sockets.length,
			replaySocketDestroyed: sockets[1]!.destroyedByBridge,
		}).toStrictEqual({
			createBroadcasts: [{type: HERDR_EVENTS.PANE_CREATED, data: replayedCreate.data}],
			snapshotBroadcasts: [{type: HERDR_EVENTS.PANES_SNAPSHOT, data: {panes: []}}],
			socketCount: 2,
			replaySocketDestroyed: false,
		});
		stop();
	});

	it("deduplicates pane_updated by revision", async () => {
		const sockets: FakeSocket[] = [];
		const lineReaders: FakeLineReader[] = [];
		const broadcasts: Broadcast[] = [];
		const stop = __testing.createBridge({
			probe: available,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => {
				const lineReader = new FakeLineReader();
				lineReaders.push(lineReader);
				return lineReader as unknown as ReadlineInterface;
			},
			getSnapshot: async () => Promise.resolve(paneState([{paneId: "w19:p9", revision: 228}])),
			getPanes: async () => Promise.resolve([]),
			paneTable: createHerdrPaneTable(),
			broadcast: (type, data) => broadcasts.push({type, data}),
			schedule: setTimeout,
			cancel: clearTimeout,
			viewedStateTracker: viewedStateTracker(),
		});
		await flushPromises();
		sockets[0]!.emit("connect");
		await flushPromises();

		lineReaders[0]!.send({
			event: "pane_updated",
			data: {pane: {pane_id: "w19:p9", revision: 228}},
		});
		lineReaders[0]!.send({
			event: "pane_updated",
			data: {pane: {pane_id: "w19:p9", revision: 229}},
		});
		lineReaders[0]!.send({
			event: "pane_updated",
			data: {pane: {pane_id: "w19:p9", revision: 229}},
		});
		await flushPromises();

		expect(broadcasts.filter((b) => b.type === HERDR_EVENTS.PANE_UPDATED)).toStrictEqual([
			{
				type: HERDR_EVENTS.PANE_UPDATED,
				data: {pane: {pane_id: "w19:p9", revision: 229}},
			},
		]);
		stop();
	});

	it("logs a failed viewed-state write with context and keeps resyncing and handling status events", async () => {
		const sockets: FakeSocket[] = [];
		const lineReaders: FakeLineReader[] = [];
		const busy = Object.assign(new Error("database is locked"), {code: "SQLITE_BUSY"});
		const tracker = {
			syncPanes: vi.fn<() => Promise<void>>().mockRejectedValueOnce(busy).mockResolvedValue(undefined),
			handleStatusEvent: vi.fn<() => Promise<void>>().mockRejectedValueOnce(busy),
		};
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const getPanes = vi.fn<BridgeDependencies["getPanes"]>(async () => Promise.resolve([]));
		const stop = __testing.createBridge({
			probe: available,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => {
				const lineReader = new FakeLineReader();
				lineReaders.push(lineReader);
				return lineReader as unknown as ReadlineInterface;
			},
			getSnapshot: async () => Promise.resolve(paneState([{paneId: "w1:p1", revision: 1}])),
			getPanes,
			paneTable: createHerdrPaneTable(),
			broadcast: () => {},
			schedule: setTimeout,
			cancel: clearTimeout,
			viewedStateTracker: tracker,
		});
		await flushPromises();
		sockets[0]!.emit("connect");
		await flushPromises();

		const statusData = {pane_id: "w1:p1", agent_status: "idle", agent: "claude"};
		lineReaders[0]!.send({event: "pane_agent_status_changed", data: statusData});
		await vi.advanceTimersByTimeAsync(250);

		expect({
			socketCount: sockets.length,
			getPanesCalls: getPanes.mock.calls.length,
			syncPanesCalls: tracker.syncPanes.mock.calls.length,
			errors: consoleError.mock.calls,
		}).toStrictEqual({
			socketCount: 1,
			getPanesCalls: 2,
			syncPanesCalls: 2,
			errors: [
				["herdr resync failed to sync viewed state for 0 panes", busy],
				["herdr status event failed to update viewed state for pane w1:p1", busy],
			],
		});
		consoleError.mockRestore();
		stop();
	});

	it("keeps the pane table current from pushed events and reseeds it after herdr reconnects", async () => {
		const sockets: FakeSocket[] = [];
		const lineReaders: FakeLineReader[] = [];
		const paneTable = createHerdrPaneTable();
		const snapshots: Array<HerdrPaneState | null> = [
			{workspaces: [], panes: [wirePane("w1:p1", 1)]},
			{workspaces: [], panes: [wirePane("w1:p1", 2, "working")]},
			null,
			{workspaces: [], panes: [wirePane("w1:p1", 3, "done")]},
		];
		const getSnapshot = vi.fn<BridgeDependencies["getSnapshot"]>(async () =>
			Promise.resolve(snapshots.shift() ?? null),
		);
		const stop = __testing.createBridge({
			probe: available,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => {
				const lineReader = new FakeLineReader();
				lineReaders.push(lineReader);
				return lineReader as unknown as ReadlineInterface;
			},
			getSnapshot,
			getPanes: async () => Promise.resolve([]),
			paneTable,
			broadcast: () => {},
			schedule: setTimeout,
			cancel: clearTimeout,
			viewedStateTracker: viewedStateTracker(),
		});
		await flushPromises();
		const seeded = paneTable.current();
		sockets[0]!.emit("connect");
		await flushPromises();

		lineReaders[0]!.send({event: "pane_created", data: {pane: wirePane("w1:p2", 0)}});
		await flushPromises();
		const afterCreate = paneTable.current();
		// The create forces a resubscribe that reseeds from the next snapshot.
		await vi.advanceTimersByTimeAsync(250);
		sockets[1]!.emit("connect");
		await flushPromises();
		lineReaders[1]!.send({
			event: "pane_agent_status_changed",
			data: {pane_id: "w1:p1", workspace_id: "w1", agent_status: "blocked"},
		});
		await flushPromises();
		const afterStatus = paneTable.current();

		sockets[1]!.emit("error", new Error("herdr went away"));
		const afterHangUp = paneTable.current();
		// The first retry finds herdr still down; the second reseeds.
		await vi.advanceTimersByTimeAsync(250);
		const whileDown = paneTable.current();
		sockets[2]!.emit("error", new Error("herdr still down"));
		await vi.advanceTimersByTimeAsync(500);
		const recovered = paneTable.current();
		stop();

		expect({
			seeded,
			afterCreate,
			afterStatus,
			afterHangUp,
			whileDown,
			recovered,
			snapshotCalls: getSnapshot.mock.calls.length,
			afterStop: paneTable.current(),
		}).toStrictEqual({
			seeded: {workspaces: [], panes: [wirePane("w1:p1", 1)]},
			afterCreate: {workspaces: [], panes: [wirePane("w1:p1", 1), wirePane("w1:p2", 0)]},
			afterStatus: {workspaces: [], panes: [wirePane("w1:p1", 2, "blocked")]},
			afterHangUp: null,
			whileDown: null,
			recovered: {workspaces: [], panes: [wirePane("w1:p1", 3, "done")]},
			snapshotCalls: 4,
			afterStop: null,
		});
	});

	it("qualifies a named session's pushed ids and subscribes with the raw ones", async () => {
		const sockets: FakeSocket[] = [];
		const lineReaders: FakeLineReader[] = [];
		const broadcasts: Broadcast[] = [];
		const tracker = viewedStateTracker();
		const paneTable = createHerdrPaneTable();
		const qualified = {
			...wirePane("wM:p1", 1),
			pane_id: "wM:p1@later",
			workspace_id: "wM@later",
			tab_id: "wM:t1@later",
		};
		const stop = __testing.createBridge({
			session: "later",
			probe: available,
			connect: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket as unknown as Socket;
			},
			createLineReader: () => {
				const lineReader = new FakeLineReader();
				lineReaders.push(lineReader);
				return lineReader as unknown as ReadlineInterface;
			},
			getSnapshot: async () => Promise.resolve({workspaces: [], panes: [qualified]}),
			getPanes: async () => Promise.resolve([]),
			paneTable,
			broadcast: (type, data) => broadcasts.push({type, data}),
			schedule: setTimeout,
			cancel: clearTimeout,
			viewedStateTracker: tracker,
		});
		await flushPromises();
		sockets[0]!.emit("connect");
		lineReaders[0]!.send({
			event: "pane_agent_status_changed",
			data: {pane_id: "wM:p1", workspace_id: "wM", agent_status: "blocked"},
		});
		await flushPromises();
		stop();

		const qualifiedStatus = {pane_id: "wM:p1@later", workspace_id: "wM@later", agent_status: "blocked"};
		expect({
			written: sockets[0]!.writes,
			statusEvents: tracker.handleStatusEvent.mock.calls,
			broadcasts: broadcasts.filter((broadcast) => broadcast.type !== HERDR_EVENTS.PANES_SNAPSHOT),
		}).toStrictEqual({
			written: [__testing.subscriptionRequest(["wM:p1"])],
			statusEvents: [[qualifiedStatus]],
			broadcasts: [{type: HERDR_EVENTS.PANE_AGENT_STATUS_CHANGED, data: qualifiedStatus}],
		});
	});
});

describe("herdr bridge manager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs one bridge per live herdr server and stops a bridge when its server goes away", async () => {
		const defaultServer = {session: null, socketPath: "/test/herdr.sock"};
		const laterServer = {session: "later", socketPath: "/test/sessions/later/herdr.sock"};
		let discovered = [defaultServer, laterServer];
		const live = new Set([defaultServer.socketPath, laterServer.socketPath]);
		const events: string[] = [];
		const known: (readonly {session: string | null; socketPath: string}[] | null)[] = [];

		const stop = __testing.createBridgeManager({
			discover: () => discovered,
			isLive: async (server) => Promise.resolve(live.has(server.socketPath)),
			startBridge: (server) => {
				events.push(`start ${server.socketPath}`);
				return () => events.push(`stop ${server.socketPath}`);
			},
			setKnownServers: (servers) => known.push(servers),
			schedule: setTimeout,
			cancel: clearTimeout,
			intervalMs: 5000,
		});
		await flushPromises();
		// An unchanged rediscovery starts nothing new.
		await vi.advanceTimersByTimeAsync(5000);
		live.delete(laterServer.socketPath);
		await vi.advanceTimersByTimeAsync(5000);
		discovered = [defaultServer];
		live.clear();
		await vi.advanceTimersByTimeAsync(5000);
		stop();
		await vi.advanceTimersByTimeAsync(20_000);

		expect({events, known}).toStrictEqual({
			events: [
				"start /test/herdr.sock",
				"start /test/sessions/later/herdr.sock",
				"stop /test/sessions/later/herdr.sock",
				"stop /test/herdr.sock",
			],
			known: [[defaultServer, laterServer], [defaultServer, laterServer], [defaultServer], null, null],
		});
	});
});
