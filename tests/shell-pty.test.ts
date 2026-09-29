import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  decodeTerminalText,
  encodeTerminalText,
  parseShellClientFrame,
  parseShellServerFrame,
  type ShellClientFrame,
  type ShellServerFrame,
} from "../src/lib/herdr/terminal-protocol";
import {
  authorizeShellSocket,
  createShellRegistry,
  handleCreateShellRequest,
  handleShellBusyRequest,
  isForegroundBusy,
  isLoopbackPeer,
  type PtyProcess,
  type ShellRegistryDependencies,
  type SpawnPty,
} from "../src/lib/shell-pty";

class FakePty implements PtyProcess {
  constructor(readonly pid = 4242) {}
  readonly written: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  readonly kills: Array<string | undefined> = [];
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];

  onData(listener: (data: string) => void) {
    this.dataListeners.push(listener);
    return { dispose: () => {} };
  }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.push(listener);
    return { dispose: () => {} };
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(columns: number, rows: number): void {
    this.resizes.push([columns, rows]);
  }
  kill(signal?: string): void {
    this.kills.push(signal);
  }
  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }
  emitExit(exitCode: number, signal?: number): void {
    for (const listener of this.exitListeners) {
      listener(signal === undefined ? { exitCode } : { exitCode, signal });
    }
  }
}

function createSocket() {
  return {
    send: vi.fn<(message: string) => void>(),
    close: vi.fn<(code?: number, reason?: string) => void>(),
  };
}

function sentFrames(socket: ReturnType<typeof createSocket>): ShellServerFrame[] {
  return socket.send.mock.calls.map(([message]) => parseShellServerFrame(message));
}

const LOOPBACK_ORIGIN = "http://127.0.0.1:7526";

function createRequest(
  body: unknown,
  headers: Record<string, string> = {},
  ip: string | null = "127.0.0.1",
): Request {
  const request = new Request(`${LOOPBACK_ORIGIN}/api/sessions/alice-session/shell`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return ip === null ? request : Object.assign(request, { ip });
}

describe("shell pty protocol codec", () => {
  it("round-trips every client and server frame through base64 text", () => {
    const text = "echo héllo ✓ 🐚\r";
    const clientFrames: ShellClientFrame[] = [
      { type: "data", data: encodeTerminalText(text) },
      { type: "resize", cols: 132, rows: 43 },
      { type: "close" },
    ];
    const serverFrames: ShellServerFrame[] = [
      { type: "opened", buffered: encodeTerminalText("Alice's prompt $ ") },
      { type: "data", data: encodeTerminalText(text) },
      { type: "exit", exitCode: 130, signal: 2 },
      { type: "exit", exitCode: 0, signal: null },
      { type: "error", message: "Session folder not found" },
    ];

    expect({
      text: decodeTerminalText(encodeTerminalText(text)),
      empty: decodeTerminalText(encodeTerminalText("")),
      client: clientFrames.map((frame) => parseShellClientFrame(JSON.stringify(frame))),
      server: serverFrames.map((frame) => parseShellServerFrame(JSON.stringify(frame))),
    }).toStrictEqual({ text, empty: "", client: clientFrames, server: serverFrames });
  });

  it("rejects malformed frames", () => {
    expect(
      [
        () => parseShellClientFrame("not json"),
        () => parseShellClientFrame(JSON.stringify({ type: "data", data: "%%%" })),
        () => parseShellClientFrame(JSON.stringify({ type: "resize", cols: 0, rows: 24 })),
        () => parseShellClientFrame(JSON.stringify({ type: "close", extra: true })),
        () => parseShellServerFrame(JSON.stringify({ type: "opened" })),
      ].map((parse) => {
        try {
          parse();
          return "parsed";
        } catch {
          return "rejected";
        }
      }),
    ).toStrictEqual(["rejected", "rejected", "rejected", "rejected", "rejected"]);
  });
});

describe("shell pty registry", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), "shell-pty-test-")));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  });

  function dependencies(
    pty: FakePty,
    overrides: Partial<ShellRegistryDependencies> = {},
  ): ShellRegistryDependencies & { spawn: ReturnType<typeof vi.fn<SpawnPty>> } {
    return {
      resolveCwd: (sessionId) => (sessionId === "alice-session" ? directory : null),
      shell: () => "/bin/zsh",
      environment: () => ({ HOME: "/Users/alice", HERDR_PANE_ID: "p-1", LANG: "en_US.UTF-8" }),
      idleTimeoutMs: 60_000,
      foregroundBusy: () => false,
      ...overrides,
      spawn: vi.fn<SpawnPty>(() => pty),
    };
  }

  it("spawns a login $SHELL in the session cwd without leaking herdr pane identity", () => {
    const pty = new FakePty();
    const deps = dependencies(pty);
    const registry = createShellRegistry(deps);

    const result = registry.create("alice-session", { cols: 100, rows: 30 });

    expect({ ok: result.ok, spawnCalls: deps.spawn.mock.calls }).toStrictEqual({
      ok: true,
      spawnCalls: [
        [
          "/bin/zsh",
          ["-l"],
          {
            name: "xterm-256color",
            cols: 100,
            rows: 30,
            cwd: directory,
            env: {
              HOME: "/Users/alice",
              LANG: "en_US.UTF-8",
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
            },
          },
        ],
      ],
    });
    registry.shutdown();
  });

  it("refuses with 409 when the session folder is unknown or gone", () => {
    const pty = new FakePty();
    const unknown = createShellRegistry(dependencies(pty));
    const gone = createShellRegistry(
      dependencies(pty, { resolveCwd: () => join(directory, "deleted-by-alice") }),
    );

    expect([
      unknown.create("bob-session", { cols: 80, rows: 24 }),
      gone.create("alice-session", { cols: 80, rows: 24 }),
    ]).toStrictEqual([
      { ok: false, status: 409, error: "Session folder not found" },
      { ok: false, status: 409, error: "Session folder not found" },
    ]);
  });

  it("replays buffered output on attach, streams data, and forwards input and resize", () => {
    const pty = new FakePty();
    const registry = createShellRegistry(dependencies(pty));
    const created = registry.create("alice-session", { cols: 80, rows: 24 });
    if (!created.ok) throw new Error("expected a shell");
    pty.emitData("alice@mac ~ % ");

    const socket = createSocket();
    const connection = registry.attach(created.ptyKey, socket);
    pty.emitData("ls\r\n");
    connection?.input(JSON.stringify({ type: "data", data: encodeTerminalText("ls\r") }));
    connection?.input(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    pty.emitExit(0);

    expect({
      sent: sentFrames(socket),
      written: pty.written,
      resizes: pty.resizes,
      closed: socket.close.mock.calls,
      remaining: registry.size(),
    }).toStrictEqual({
      sent: [
        { type: "opened", buffered: encodeTerminalText("alice@mac ~ % ") },
        { type: "data", data: encodeTerminalText("ls\r\n") },
        { type: "exit", exitCode: 0, signal: null },
      ],
      written: ["ls\r"],
      resizes: [[120, 40]],
      closed: [[1000, "shell exited"]],
      remaining: 0,
    });
  });

  it("kills the shell on a close frame and after the idle timeout while detached", () => {
    vi.useFakeTimers();
    const closedPty = new FakePty();
    const idlePty = new FakePty();
    const ptys = [closedPty, idlePty];
    const registry = createShellRegistry({
      ...dependencies(closedPty),
      spawn: vi.fn<SpawnPty>(() => ptys.shift()!),
    });
    const closed = registry.create("alice-session", { cols: 80, rows: 24 });
    const idle = registry.create("alice-session", { cols: 80, rows: 24 });
    if (!closed.ok || !idle.ok) throw new Error("expected shells");

    registry.attach(closed.ptyKey, createSocket())?.input(JSON.stringify({ type: "close" }));
    const idleConnection = registry.attach(idle.ptyKey, createSocket());
    idleConnection?.detach();
    vi.advanceTimersByTime(59_999);
    const killsBeforeTimeout = idlePty.kills.length;
    vi.advanceTimersByTime(1);

    expect({
      closedKills: closedPty.kills.length,
      killsBeforeTimeout,
      idleKills: idlePty.kills.length,
      remaining: registry.size(),
      unknown: registry.attach("no-such-key", createSocket()),
    }).toStrictEqual({
      closedKills: 1,
      killsBeforeTimeout: 0,
      idleKills: 1,
      remaining: 0,
      unknown: null,
    });
  });

  it("reports which live shells have a foreground command running", () => {
    const idlePty = new FakePty(4242);
    const busyPty = new FakePty(4343);
    const ptys = [idlePty, busyPty];
    const foregroundBusy = vi.fn((pid: number) => pid === 4343);
    const registry = createShellRegistry({
      ...dependencies(idlePty, { foregroundBusy }),
      spawn: vi.fn<SpawnPty>(() => ptys.shift()!),
    });
    const idle = registry.create("alice-session", { cols: 80, rows: 24 });
    const busy = registry.create("alice-session", { cols: 80, rows: 24 });
    if (!idle.ok || !busy.ok) throw new Error("expected shells");

    expect({
      busy: registry.busy([idle.ptyKey, busy.ptyKey, "no-such-key"]),
      checked: foregroundBusy.mock.calls,
    }).toStrictEqual({ busy: [busy.ptyKey], checked: [[4242], [4343]] });
    registry.shutdown();
  });

  it("runs a real login shell in the session folder", async () => {
    const { spawn } = await import("node-pty");
    const registry = createShellRegistry({
      resolveCwd: () => directory,
      shell: () => "/bin/sh",
      environment: () => ({ PATH: "/usr/bin:/bin", HOME: directory }),
      spawn: spawn as unknown as SpawnPty,
      idleTimeoutMs: 60_000,
      foregroundBusy: isForegroundBusy,
    });
    const created = registry.create("alice-session", { cols: 80, rows: 24 });
    if (!created.ok) throw new Error(created.error);
    const socket = createSocket();
    const connection = registry.attach(created.ptyKey, socket);
    const idleAtPrompt = await vi.waitFor(
      () => {
        expect(sentFrames(socket).length).toBeGreaterThan(1);
        return registry.busy([created.ptyKey]);
      },
      { timeout: 10_000 },
    );
    connection?.input(JSON.stringify({ type: "data", data: encodeTerminalText("sleep 30\n") }));
    await vi.waitFor(
      () => {
        expect(registry.busy([created.ptyKey])).toStrictEqual([created.ptyKey]);
      },
      { timeout: 10_000 },
    );
    connection?.input(JSON.stringify({ type: "data", data: encodeTerminalText("\u0003") }));
    await vi.waitFor(
      () => {
        expect(registry.busy([created.ptyKey])).toStrictEqual([]);
      },
      { timeout: 10_000 },
    );
    expect(idleAtPrompt).toStrictEqual([]);
    connection?.input(JSON.stringify({ type: "data", data: encodeTerminalText("pwd; exit 7\n") }));

    await vi.waitFor(
      () => {
        expect(sentFrames(socket).at(-1)).toStrictEqual({
          type: "exit",
          exitCode: 7,
          signal: null,
        });
      },
      { timeout: 10_000 },
    );
    const output = sentFrames(socket)
      .map((frame) =>
        frame.type === "data"
          ? decodeTerminalText(frame.data)
          : frame.type === "opened"
            ? decodeTerminalText(frame.buffered)
            : "",
      )
      .join("");
    expect(output.split(/\r?\n/)).toContain(directory);
    registry.shutdown();
  });
});

describe("shell pty request gates", () => {
  function registryStub() {
    return {
      create: vi.fn(() => ({ ok: true as const, ptyKey: "pty-key-alice" })),
    };
  }

  it("creates a shell for a same-origin loopback request with the setting on", async () => {
    const registry = registryStub();
    const response = await handleCreateShellRequest(
      createRequest({ cols: 90, rows: 20 }, { Origin: LOOPBACK_ORIGIN }),
      "alice-session",
      { registry, enabled: () => true },
    );

    expect({
      status: response.status,
      body: await response.json(),
      calls: registry.create.mock.calls,
    }).toStrictEqual({
      status: 200,
      body: { ptyKey: "pty-key-alice" },
      calls: [["alice-session", { cols: 90, rows: 20 }]],
    });
  });

  it("enforces the shellPaneEnabled setting, same-origin, and loopback on both routes", async () => {
    // Dev upgrades carry no peer ip, so the socket defers that check to the
    // crossws peer address in open(); the create route requires it outright.
    const registry = registryStub();
    const statuses = await Promise.all(
      [
        { request: createRequest({}), enabled: false },
        { request: createRequest({}, { Origin: "https://evil.example" }), enabled: true },
        { request: createRequest({}, { "Sec-Fetch-Site": "cross-site" }), enabled: true },
        { request: createRequest({}, {}, "192.168.1.20"), enabled: true },
        { request: createRequest({}, { "X-Forwarded-For": "100.64.0.9" }), enabled: true },
        { request: createRequest({}, {}, null), enabled: true },
      ].map(async ({ request, enabled }) => {
        const response = await handleCreateShellRequest(request, "alice-session", {
          registry,
          enabled: () => enabled,
        });
        return [response.status, await response.json()];
      }),
    );
    const socketGate = [
      authorizeShellSocket(createRequest({}), { enabled: () => false })?.status,
      authorizeShellSocket(createRequest({}, {}, "10.0.0.2"), { enabled: () => true })?.status,
      authorizeShellSocket(createRequest({}, { "X-Forwarded-For": "100.64.0.9" }, null), {
        enabled: () => true,
      })?.status,
      authorizeShellSocket(createRequest({}, {}, "::1"), { enabled: () => true }),
      authorizeShellSocket(createRequest({}, {}, "::ffff:127.0.0.1"), { enabled: () => true }),
      authorizeShellSocket(createRequest({}, {}, null), { enabled: () => true }),
    ];
    const peers = [undefined, "", "192.168.1.20", "127.0.0.1", "::1", "::ffff:127.0.0.1"].map(
      isLoopbackPeer,
    );

    expect({
      statuses,
      socketGate,
      peers,
      created: registry.create.mock.calls.length,
    }).toStrictEqual({
      statuses: [
        [403, { error: "Shell tabs are disabled" }],
        [403, { error: "Forbidden" }],
        [403, { error: "Forbidden" }],
        [403, { error: "Shell tabs are only available from this computer" }],
        [403, { error: "Shell tabs are only available from this computer" }],
        [403, { error: "Shell tabs are only available from this computer" }],
      ],
      socketGate: [403, 403, 403, null, null, null],
      peers: [false, false, false, true, true, true],
      created: 0,
    });
  });

  it("answers which shells are busy behind the same gates", async () => {
    const aliceKey = "0f6c1c1e-8a52-4d7e-9a43-2b1f3c1d5e01";
    const bobKey = "0f6c1c1e-8a52-4d7e-9a43-2b1f3c1d5e02";
    const registry = {
      busy: vi.fn((keys: readonly string[]) => keys.filter((key) => key === bobKey)),
    };
    const ask = async (request: Request, enabled = true) => {
      const response = await handleShellBusyRequest(request, { registry, enabled: () => enabled });
      return [response.status, await response.json()];
    };

    expect(
      await Promise.all([
        ask(createRequest({ ptyKeys: [aliceKey, bobKey] }, { Origin: LOOPBACK_ORIGIN })),
        ask(createRequest({ ptyKeys: [aliceKey] }), false),
        ask(createRequest({ ptyKeys: [aliceKey] }, {}, "192.168.1.20")),
        ask(createRequest({ ptyKeys: ["not-a-key"] })),
        ask(createRequest({ ptyKeys: [aliceKey], extra: true })),
      ]),
    ).toStrictEqual([
      [200, { busy: [bobKey] }],
      [403, { error: "Shell tabs are disabled" }],
      [403, { error: "Shell tabs are only available from this computer" }],
      [400, { error: "Invalid shell request" }],
      [400, { error: "Invalid shell request" }],
    ]);
  });

  it("maps registry refusals to their status", async () => {
    const response = await handleCreateShellRequest(createRequest({}), "bob-session", {
      registry: {
        create: () => ({ ok: false as const, status: 409, error: "Session folder not found" }),
      },
      enabled: () => true,
    });

    expect([response.status, await response.json()]).toStrictEqual([
      409,
      { error: "Session folder not found" },
    ]);
  });
});
