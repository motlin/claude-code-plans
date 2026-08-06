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

describe("herdr event bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not subscribe when the availability probe reports no daemon", async () => {
    const sockets: FakeSocket[] = [];
    const lineReaders: FakeLineReader[] = [];
    const getPanes = vi.fn(async () => []);
    const broadcasts: Broadcast[] = [];

    const stop = __testing.createBridge({
      probe: unavailable,
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
      getPaneIds: async () => ["workspace-100:pane-100"],
      getPanes,
      broadcast: (type, data) => broadcasts.push({ type, data }),
      schedule: setTimeout,
      cancel: clearTimeout,
    });
    await flushPromises();

    expect({ sockets, getPanesCalls: getPanes.mock.calls, broadcasts }).toStrictEqual({
      sockets: [],
      getPanesCalls: [],
      broadcasts: [],
    });
    stop();
  });

  it("uses dot subscriptions, maps snake-case pushes, and coalesces snapshot resyncs", async () => {
    const sockets: FakeSocket[] = [];
    const lineReaders: FakeLineReader[] = [];
    const broadcasts: Broadcast[] = [];
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
      getPaneIds: async () => ["workspace-100:pane-100"],
      getPanes,
      broadcast: (type, data) => broadcasts.push({ type, data }),
      schedule: setTimeout,
      cancel: clearTimeout,
    });
    await flushPromises();

    const socket = sockets[0]!;
    const lineReader = lineReaders[0]!;
    socket.emit("connect");
    await flushPromises();
    lineReader.send({ id: "ccp:sub", result: { type: "subscription_started" } });
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

    expect({ writes: socket.writes, broadcasts, getPanesCalls: getPanes.mock.calls }).toStrictEqual(
      {
        writes: [
          '{"id":"ccp:sub","method":"events.subscribe","params":{"subscriptions":[{"type":"pane.created"},{"type":"pane.closed"},{"type":"pane.updated"},{"type":"pane.moved"},{"type":"pane.exited"},{"type":"pane.agent_detected"},{"type":"pane.agent_status_changed","pane_id":"workspace-100:pane-100"}]}}\n',
        ],
        broadcasts: [
          { type: HERDR_EVENTS.PANES_SNAPSHOT, data: { panes: [] } },
          {
            type: HERDR_EVENTS.PANE_CREATED,
            data: { pane_id: "workspace-100:pane-100" },
          },
          {
            type: HERDR_EVENTS.PANE_CLOSED,
            data: { pane_id: "workspace-100:pane-200" },
          },
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
      },
    );

    await vi.advanceTimersByTimeAsync(249);
    expect(getPanes.mock.calls).toStrictEqual([[]]);
    await vi.advanceTimersByTimeAsync(1);
    expect({ getPanesCalls: getPanes.mock.calls, lastBroadcast: broadcasts.at(-1) }).toStrictEqual({
      getPanesCalls: [[], []],
      lastBroadcast: { type: HERDR_EVENTS.PANES_SNAPSHOT, data: { panes: [] } },
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
      getPaneIds: async () => ["workspace-100:pane-100"],
      getPanes: async () => [],
      broadcast: () => {},
      schedule: (callback, delayMs) => {
        scheduledDelays.push(delayMs);
        return setTimeout(callback, delayMs);
      },
      cancel: clearTimeout,
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
      getPaneIds: async () => ["workspace-100:pane-100"],
      getPanes,
      broadcast: () => {},
      schedule: setTimeout,
      cancel: clearTimeout,
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
});
