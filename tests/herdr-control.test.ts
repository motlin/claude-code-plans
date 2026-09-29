import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  authorizeTerminalControl,
  controlHerdrSession,
  startTerminalController,
  type TerminalControllerDependencies,
} from "../src/lib/herdr/terminal-controller";
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
  const stdin = new PassThrough();
  const written: string[] = [];
  stdin.on("data", (chunk: Buffer) => written.push(chunk.toString()));
  return Object.assign(emitter, {
    stdin,
    written,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
  });
}

function createSocket() {
  return {
    send: vi.fn<(message: string) => void>(),
    close: vi.fn<(code?: number, reason?: string) => void>(),
  };
}

type SpawnController = TerminalControllerDependencies["spawnController"];

async function flushStreams(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function upgradeRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost:7526/api/herdr/control?sessionId=a&columns=80&rows=24", {
    headers,
  });
}

describe("herdr terminal control stream", () => {
  it("spawns control without takeover and writes data and resize frames to stdin", async () => {
    const child = createFakeChild();
    const spawnController = vi.fn(() => child);
    const socket = createSocket();

    const controller = startTerminalController(
      { target: "terminal-test-100", columns: 120, rows: 40 },
      socket,
      spawnController as unknown as SpawnController,
    );
    child.stdout.write(`${JSON.stringify(frame(100, true))}\n`);
    controller.input(JSON.stringify({ type: "data", data: "Alice types\r" }));
    controller.input(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
    await flushStreams();

    expect({
      spawnCalls: spawnController.mock.calls,
      stdin: child.written.join(""),
      sent: socket.send.mock.calls,
      closed: socket.close.mock.calls,
    }).toStrictEqual({
      spawnCalls: [
        [
          "herdr",
          ["terminal", "session", "control", "terminal-test-100", "--cols", "120", "--rows", "40"],
          { stdio: ["pipe", "pipe", "pipe"] },
        ],
      ],
      stdin:
        `${JSON.stringify({ type: "terminal.input", text: "Alice types\r" })}\n` +
        `${JSON.stringify({ type: "terminal.resize", cols: 100, rows: 30 })}\n`,
      sent: [[JSON.stringify(frame(100, true))]],
      closed: [],
    });
  });

  it("rejects a malformed client frame and stops the child", async () => {
    const child = createFakeChild();
    const socket = createSocket();

    const controller = startTerminalController(
      { target: "terminal-test-100", columns: 80, rows: 24 },
      socket,
      (() => child) as unknown as SpawnController,
    );
    controller.input(JSON.stringify({ type: "resize", cols: 0, rows: 24 }));
    controller.input(JSON.stringify({ type: "data", data: "ignored after failure" }));
    await flushStreams();

    expect({
      stdin: child.written,
      sent: socket.send.mock.calls,
      closed: socket.close.mock.calls,
      killed: child.kill.mock.calls,
    }).toStrictEqual({
      stdin: [],
      sent: [
        [JSON.stringify({ type: "observer.error", message: "invalid terminal control frame" })],
      ],
      closed: [[1008, "invalid terminal control frame"]],
      killed: [["SIGTERM"]],
    });
  });

  it("resolves the session's herdr terminal before spawning control", async () => {
    const child = createFakeChild();
    const spawnController = vi.fn(() => child);
    const resolveTarget = vi.fn(() => Promise.resolve("terminal-test-200"));

    await controlHerdrSession("session-test-100", 90, 30, createSocket(), {
      resolveTarget,
      spawnController: spawnController as unknown as SpawnController,
    });

    expect({
      resolved: resolveTarget.mock.calls,
      spawnArguments: spawnController.mock.calls.map((call) => (call as unknown[])[1]),
    }).toStrictEqual({
      resolved: [["session-test-100"]],
      spawnArguments: [
        ["terminal", "session", "control", "terminal-test-200", "--cols", "90", "--rows", "30"],
      ],
    });
  });
});

describe("herdr terminal control authorization", () => {
  it("rejects cross-site upgrades before checking the writes setting", async () => {
    const writesEnabled = vi.fn(() => true);
    const response = authorizeTerminalControl(
      upgradeRequest({ Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }),
      { writesEnabled },
    );

    expect({
      status: response?.status,
      body: await response?.json(),
      checkedWrites: writesEnabled.mock.calls.length,
    }).toStrictEqual({ status: 403, body: { error: "Forbidden" }, checkedWrites: 0 });
  });

  it("returns 403 when herdr writes are disabled", async () => {
    const response = authorizeTerminalControl(
      upgradeRequest({ Origin: "http://localhost:7526", "Sec-Fetch-Site": "same-origin" }),
      { writesEnabled: () => false },
    );

    expect({ status: response?.status, body: await response?.json() }).toStrictEqual({
      status: 403,
      body: { error: "herdr writes are disabled" },
    });
  });

  it("allows same-origin upgrades when herdr writes are enabled", () => {
    expect(
      authorizeTerminalControl(
        upgradeRequest({ Origin: "http://localhost:7526", "Sec-Fetch-Site": "same-origin" }),
        { writesEnabled: () => true },
      ),
    ).toBeNull();
  });
});
