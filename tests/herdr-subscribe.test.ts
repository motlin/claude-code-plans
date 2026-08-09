import { EventEmitter } from "node:events";
import type { Interface as ReadlineInterface } from "node:readline";
import type { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { HERDR_EVENTS } from "../src/lib/hook-events";
import { __testing } from "../src/lib/herdr/subscribe";

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

function available() {
  return Promise.resolve({
    available: true as const,
    socketPath: "/test/herdr.sock",
    version: "0.8.0-test",
    protocol: 100,
  });
}

function unavailable() {
  return Promise.resolve({
    available: false as const,
    socketPath: "/test/herdr.sock",
    reason: "no-socket" as const,
  });
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function viewedStateTracker() {
  return {
    syncPanes: vi.fn(),
    handleStatusEvent: vi.fn(),
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
    const getPanes = vi.fn(async () => []);
    const broadcasts: Broadcast[] = [];
    const expectedBackoffs = [250, 500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000];
    let probeAttempts = 0;
    const probe = vi.fn(() => {
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
      getPaneSnapshot: async () => [{ paneId: "workspace-100:pane-100", revision: 0 }],
      getPanes,
      broadcast: (type, data) => broadcasts.push({ type, data }),
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
      broadcasts: [{ type: HERDR_EVENTS.PANES_SNAPSHOT, data: { panes: [] } }],
    });
    stop();
  });

  it("cancels an unavailable probe retry during teardown", async () => {
    const scheduledDelays: number[] = [];
    const probe = vi.fn(unavailable);
    const cancel = vi.fn((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));

    const stop = __testing.createBridge({
      probe,
      connect: () => new FakeSocket() as unknown as Socket,
      createLineReader: () => new FakeLineReader() as unknown as ReadlineInterface,
      getPaneSnapshot: async () => [{ paneId: "workspace-100:pane-100", revision: 0 }],
      getPanes: async () => [],
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
    }).toStrictEqual({ probeCalls: [[]], scheduledDelays: [250], cancelCallCount: 1 });
  });

  it("uses dot subscriptions, maps snake-case pushes, and coalesces snapshot resyncs", async () => {
    const sockets: FakeSocket[] = [];
    const lineReaders: FakeLineReader[] = [];
    const broadcasts: Broadcast[] = [];
    const getPanes = vi.fn(async () => []);
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
      getPaneSnapshot: async () => [{ paneId: "workspace-100:pane-100", revision: 0 }],
      getPanes,
      broadcast: (type, data) => broadcasts.push({ type, data }),
      schedule: setTimeout,
      cancel: clearTimeout,
      viewedStateTracker: tracker,
    });
    await flushPromises();

    const socket = sockets[0]!;
    const lineReader = lineReaders[0]!;
    socket.emit("connect");
    await flushPromises();
    lineReader.send({ id: "ccp:sub", result: { type: "subscription_started" } });
    // Replayed create for the already-subscribed pane and a close for an
    // unknown pane are both deduplicated away.
    lineReader.send({ event: "pane_created", data: { pane_id: "workspace-100:pane-100" } });
    lineReader.send({ event: "pane_closed", data: { pane_id: "workspace-100:pane-200" } });
    lineReader.send({ event: "pane_updated", data: { pane_id: "workspace-100:pane-300" } });
    lineReader.send({ event: "pane_moved", data: { pane_id: "workspace-100:pane-400" } });
    lineReader.send({ event: "pane_exited", data: { pane_id: "workspace-100:pane-500" } });
    lineReader.send({
      event: "pane_agent_detected",
      data: { pane_id: "workspace-100:pane-600" },
    });
    lineReader.send({
      event: "pane_agent_status_changed",
      data: { pane_id: "workspace-100:pane-700" },
    });
    lineReader.send({ event: "pane_focused", data: { pane_id: "workspace-100:pane-800" } });
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
        { type: HERDR_EVENTS.PANES_SNAPSHOT, data: { panes: [] } },
        {
          type: HERDR_EVENTS.PANE_UPDATED,
          data: { pane_id: "workspace-100:pane-300" },
        },
        { type: HERDR_EVENTS.PANE_MOVED, data: { pane_id: "workspace-100:pane-400" } },
        { type: HERDR_EVENTS.PANE_EXITED, data: { pane_id: "workspace-100:pane-500" } },
        {
          type: HERDR_EVENTS.PANE_AGENT_DETECTED,
          data: { pane_id: "workspace-100:pane-600" },
        },
        {
          type: HERDR_EVENTS.PANE_AGENT_STATUS_CHANGED,
          data: { pane_id: "workspace-100:pane-700" },
        },
      ],
      getPanesCalls: [[]],
      syncedPanes: [[[]]],
      statusEvents: [[{ pane_id: "workspace-100:pane-700" }]],
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(getPanes.mock.calls).toStrictEqual([[]]);
    await vi.advanceTimersByTimeAsync(1);
    // The coalesced resync runs but its payload is unchanged, so the
    // identical snapshot is not rebroadcast.
    expect({ getPanesCalls: getPanes.mock.calls, lastBroadcast: broadcasts.at(-1) }).toStrictEqual({
      getPanesCalls: [[], []],
      lastBroadcast: {
        type: HERDR_EVENTS.PANE_AGENT_STATUS_CHANGED,
        data: { pane_id: "workspace-100:pane-700" },
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
      getPaneSnapshot: async () => [{ paneId: "workspace-100:pane-100", revision: 0 }],
      getPanes: async () => [],
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

  it("destroys the active socket and cancels pending resync during teardown", async () => {
    const sockets: FakeSocket[] = [];
    const lineReaders: FakeLineReader[] = [];
    const getPanes = vi.fn(async () => []);
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
      getPaneSnapshot: async () => [{ paneId: "workspace-100:pane-100", revision: 0 }],
      getPanes,
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
    lineReader.send({ event: "pane_updated", data: { pane_id: "workspace-100:pane-100" } });
    await flushPromises();

    stop();
    await vi.advanceTimersByTimeAsync(250);

    expect({
      destroyedByBridge: socket.destroyedByBridge,
      getPanesCalls: getPanes.mock.calls,
      lineReaderClosed: lineReader.closed,
    }).toStrictEqual({ destroyedByBridge: true, getPanesCalls: [[]], lineReaderClosed: true });
  });

  it("announces a new pane once even though herdr replays its create on every resubscribe", async () => {
    const sockets: FakeSocket[] = [];
    const lineReaders: FakeLineReader[] = [];
    const broadcasts: Broadcast[] = [];
    let snapshotCalls = 0;
    const replayedCreate = {
      event: "pane_created",
      data: { pane: { pane_id: "wE:p17", revision: 0 } },
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
      getPaneSnapshot: async () => {
        snapshotCalls += 1;
        return snapshotCalls === 1 ? [] : [{ paneId: "wE:p17", revision: 0 }];
      },
      getPanes: async () => [],
      broadcast: (type, data) => broadcasts.push({ type, data }),
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
      createBroadcasts: [{ type: HERDR_EVENTS.PANE_CREATED, data: replayedCreate.data }],
      snapshotBroadcasts: [{ type: HERDR_EVENTS.PANES_SNAPSHOT, data: { panes: [] } }],
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
      getPaneSnapshot: async () => [{ paneId: "w19:p9", revision: 228 }],
      getPanes: async () => [],
      broadcast: (type, data) => broadcasts.push({ type, data }),
      schedule: setTimeout,
      cancel: clearTimeout,
      viewedStateTracker: viewedStateTracker(),
    });
    await flushPromises();
    sockets[0]!.emit("connect");
    await flushPromises();

    lineReaders[0]!.send({
      event: "pane_updated",
      data: { pane: { pane_id: "w19:p9", revision: 228 } },
    });
    lineReaders[0]!.send({
      event: "pane_updated",
      data: { pane: { pane_id: "w19:p9", revision: 229 } },
    });
    lineReaders[0]!.send({
      event: "pane_updated",
      data: { pane: { pane_id: "w19:p9", revision: 229 } },
    });
    await flushPromises();

    expect(broadcasts.filter((b) => b.type === HERDR_EVENTS.PANE_UPDATED)).toStrictEqual([
      {
        type: HERDR_EVENTS.PANE_UPDATED,
        data: { pane: { pane_id: "w19:p9", revision: 229 } },
      },
    ]);
    stop();
  });
});
