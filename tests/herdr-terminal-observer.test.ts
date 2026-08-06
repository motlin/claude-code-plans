import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  __testing,
  createTerminalRecordParser,
  observeHerdrSession,
  startTerminalObserver,
  stopAllTerminalObservers,
  type TerminalObserverDependencies,
} from "../src/lib/herdr/terminal-observer";
import type { HerdrTerminalRecord } from "../src/lib/herdr/terminal-protocol";

function frame(sequence: number, full: boolean): HerdrTerminalRecord {
  return {
    type: "terminal.frame",
    seq: sequence,
    encoding: "ansi",
    width: 80,
    height: 24,
    full,
    bytes: Buffer.from(`Alice frame ${sequence}`).toString("base64"),
  };
}

function createFakeChild() {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
  });
  return child;
}

function createSocket() {
  return {
    send: vi.fn<(message: string) => void>(),
    close: vi.fn<(code?: number, reason?: string) => void>(),
  };
}

describe("herdr terminal observer NDJSON bridge", () => {
  it("parses chunked and multiple records without changing their complete values", () => {
    const records: HerdrTerminalRecord[] = [];
    const errors: string[] = [];
    const parser = createTerminalRecordParser(
      (record) => records.push(record),
      (error) => errors.push(error.message),
    );
    const first = JSON.stringify(frame(100, true));
    const second = JSON.stringify(frame(200, false));

    parser.push(first.slice(0, 25));
    parser.push(`${first.slice(25)}\n${second}\n{"type":"terminal.`);
    parser.push('closed","reason":"Alice finished"}\n');
    parser.end();

    expect({ records, errors }).toStrictEqual({
      records: [
        frame(100, true),
        frame(200, false),
        { type: "terminal.closed", reason: "Alice finished" },
      ],
      errors: [],
    });
  });

  it("rejects a stream that ends with an incomplete record", () => {
    const records: HerdrTerminalRecord[] = [];
    const errors: string[] = [];
    const parser = createTerminalRecordParser(
      (record) => records.push(record),
      (error) => errors.push(error.message),
    );

    parser.push('{"type":"terminal.closed"');
    parser.end();

    expect({ records, errors }).toStrictEqual({
      records: [],
      errors: ["terminal observer ended with an incomplete record"],
    });
  });

  it("rejects a malformed complete record", () => {
    const records: HerdrTerminalRecord[] = [];
    const errors: string[] = [];
    const parser = createTerminalRecordParser(
      (record) => records.push(record),
      (error) => errors.push(error.name),
    );

    parser.push("not-json\n");

    expect({ records, errors }).toStrictEqual({ records: [], errors: ["SyntaxError"] });
  });

  it("spawns only observe, forwards a monotonic stream, and cleans up on terminal.closed", () => {
    const child = createFakeChild();
    const spawnObserver = vi.fn(() => child);
    const socket = createSocket();

    startTerminalObserver(
      { target: "terminal-test-100", columns: 120, rows: 40 },
      socket,
      spawnObserver as unknown as TerminalObserverDependencies["spawnObserver"],
    );
    child.stdout.write(`${JSON.stringify(frame(100, true))}\n`);
    child.stdout.write(
      `${JSON.stringify(frame(200, false))}\n${JSON.stringify({ type: "terminal.closed" })}\n`,
    );

    expect({
      spawnCalls: spawnObserver.mock.calls,
      sent: socket.send.mock.calls,
      closed: socket.close.mock.calls,
      killed: child.kill.mock.calls,
      activeObservers: __testing.activeObserverCount(),
    }).toStrictEqual({
      spawnCalls: [
        [
          "herdr",
          ["terminal", "session", "observe", "terminal-test-100", "--cols", "120", "--rows", "40"],
          { stdio: ["ignore", "pipe", "pipe"] },
        ],
      ],
      sent: [
        [JSON.stringify(frame(100, true))],
        [JSON.stringify(frame(200, false))],
        [JSON.stringify({ type: "terminal.closed" })],
      ],
      closed: [[1000, "terminal closed"]],
      killed: [["SIGTERM"]],
      activeObservers: 0,
    });
  });

  it("requires a full keyframe and rejects repeated sequence numbers", () => {
    const firstChild = createFakeChild();
    const secondChild = createFakeChild();
    const children = [firstChild, secondChild];
    const spawnObserver = vi.fn(() => children.shift()!);
    const firstSocket = createSocket();
    const secondSocket = createSocket();

    startTerminalObserver(
      { target: "terminal-test-100", columns: 80, rows: 24 },
      firstSocket,
      spawnObserver as unknown as TerminalObserverDependencies["spawnObserver"],
    );
    firstChild.stdout.write(`${JSON.stringify(frame(100, false))}\n`);

    startTerminalObserver(
      { target: "terminal-test-200", columns: 80, rows: 24 },
      secondSocket,
      spawnObserver as unknown as TerminalObserverDependencies["spawnObserver"],
    );
    secondChild.stdout.write(
      `${JSON.stringify(frame(100, true))}\n${JSON.stringify(frame(100, false))}\n`,
    );

    expect({
      first: {
        sent: firstSocket.send.mock.calls,
        closed: firstSocket.close.mock.calls,
        killed: firstChild.kill.mock.calls,
      },
      second: {
        sent: secondSocket.send.mock.calls,
        closed: secondSocket.close.mock.calls,
        killed: secondChild.kill.mock.calls,
      },
    }).toStrictEqual({
      first: {
        sent: [
          [
            JSON.stringify({
              type: "observer.error",
              message: "terminal observer did not begin with a full keyframe",
            }),
          ],
        ],
        closed: [[1011, "terminal observer failed"]],
        killed: [["SIGTERM"]],
      },
      second: {
        sent: [
          [JSON.stringify(frame(100, true))],
          [
            JSON.stringify({
              type: "observer.error",
              message: "terminal frame sequence did not advance",
            }),
          ],
        ],
        closed: [[1011, "terminal observer failed"]],
        killed: [["SIGTERM"]],
      },
    });
  });

  it("resolves a session to a terminal and closes sockets during server shutdown", async () => {
    const child = createFakeChild();
    const spawnObserver = vi.fn(() => child);
    const resolveTarget = vi.fn(async () => "terminal-test-100");
    const socket = createSocket();

    await observeHerdrSession("session-test-100", 90, 30, socket, {
      resolveTarget,
      spawnObserver: spawnObserver as unknown as TerminalObserverDependencies["spawnObserver"],
    });
    stopAllTerminalObservers();

    expect({
      resolved: resolveTarget.mock.calls,
      command: spawnObserver.mock.calls,
      closed: socket.close.mock.calls,
      killed: child.kill.mock.calls,
      activeObservers: __testing.activeObserverCount(),
    }).toStrictEqual({
      resolved: [["session-test-100"]],
      command: [
        [
          "herdr",
          ["terminal", "session", "observe", "terminal-test-100", "--cols", "90", "--rows", "30"],
          { stdio: ["ignore", "pipe", "pipe"] },
        ],
      ],
      closed: [[1012, "terminal observer server stopped"]],
      killed: [["SIGTERM"]],
      activeObservers: 0,
    });
  });

  it("terminates the child when its WebSocket connection disconnects", () => {
    const child = createFakeChild();
    const socket = createSocket();
    const observer = startTerminalObserver(
      { target: "terminal-test-100", columns: 80, rows: 24 },
      socket,
      vi.fn(() => child) as unknown as TerminalObserverDependencies["spawnObserver"],
    );

    observer.stop();

    expect({
      socketClosed: socket.close.mock.calls,
      childKilled: child.kill.mock.calls,
      activeObservers: __testing.activeObserverCount(),
    }).toStrictEqual({
      socketClosed: [],
      childKilled: [["SIGTERM"]],
      activeObservers: 0,
    });
  });
});
