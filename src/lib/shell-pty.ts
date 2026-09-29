/**
 * Shell tabs for the session Terminal pane: plain `$SHELL -l` PTYs in the
 * session folder, like claude.ai/code's desktop terminal.
 *
 * Backend spike (node-pty vs `herdr pane split --cwd` + control stream):
 * node-pty won. It needs no running herdr server, gives the shell a real
 * PTY we own (exit codes, resize, kill, buffered replay on reconnect), and
 * adds nothing to the user's herdr layout. A herdr split would create a
 * visible pane in the user's workspace per tab, fail whenever herdr is not
 * running, and leave pane cleanup to herdr. node-pty 1.2.0-beta.15 ships
 * working darwin prebuilds (1.1.0's spawn-helper lacks the exec bit, so
 * posix_spawnp fails); it must be traced into the Nitro build so the prod
 * output keeps spawn-helper.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { spawn as spawnNodePty } from "node-pty";
import { z } from "zod";
import { shellPaneEnabled } from "./config";
import { getDb } from "./db";
import { getSessionDirectory } from "./db/queries";
import type { TerminalObserverSocket } from "./herdr/terminal-observer";
import {
  decodeTerminalText,
  encodeTerminalText,
  parseShellClientFrame,
} from "./herdr/terminal-protocol";
import { rejectCrossSite } from "./same-origin-guard";

export interface PtyProcess {
  readonly pid: number;
  onData: (listener: (data: string) => void) => { dispose: () => void };
  onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
    dispose: () => void;
  };
  write: (data: string) => void;
  resize: (columns: number, rows: number) => void;
  kill: (signal?: string) => void;
}

export type SpawnPty = (
  file: string,
  arguments_: string[],
  options: {
    name: string;
    cols: number;
    rows: number;
    cwd: string;
    env: Record<string, string>;
  },
) => PtyProcess;

export interface ShellRegistryDependencies {
  resolveCwd: (sessionId: string) => string | null;
  shell: () => string;
  environment: () => Record<string, string | undefined>;
  spawn: SpawnPty;
  /** How long a shell with no attached tab survives before it is killed. */
  idleTimeoutMs: number;
  /** Whether the shell with this pid has handed its terminal to a foreground job. */
  foregroundBusy: (pid: number) => boolean;
}

export type CreateShellResult =
  | { ok: true; ptyKey: string }
  | { ok: false; status: number; error: string };

export interface ShellConnection {
  /** Apply one client frame: `{type:"data"|"resize"|"close"}`. */
  input: (message: string) => void;
  /** The socket went away; the shell keeps running until the idle timeout. */
  detach: () => void;
}

export interface ShellRegistry {
  create: (sessionId: string, size: { cols: number; rows: number }) => CreateShellResult;
  attach: (ptyKey: string, socket: TerminalObserverSocket) => ShellConnection | null;
  /** The given shells that are still running a foreground command. */
  busy: (ptyKeys: readonly string[]) => string[];
  shutdown: () => void;
  size: () => number;
}

/** Output kept for replay when a tab reconnects, measured in UTF-16 code units. */
const MAXIMUM_BUFFERED_OUTPUT = 512 * 1024;

const TERMINAL_ENVIRONMENT = { TERM: "xterm-256color", COLORTERM: "truecolor" } as const;

interface ShellEntry {
  pty: PtyProcess;
  buffered: string;
  socket: TerminalObserverSocket | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The server's own environment minus herdr's pane identity: a shell spawned
 * from a server running inside a herdr pane must not report itself as that
 * pane.
 */
function shellEnvironment(source: Record<string, string | undefined>): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || key.startsWith("HERDR_")) continue;
    environment[key] = value;
  }
  return { ...environment, ...TERMINAL_ENVIRONMENT };
}

export function createShellRegistry(dependencies: ShellRegistryDependencies): ShellRegistry {
  const shells = new Map<string, ShellEntry>();

  const remove = (ptyKey: string): void => {
    const entry = shells.get(ptyKey);
    if (!entry) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    shells.delete(ptyKey);
  };

  const kill = (ptyKey: string): void => {
    const entry = shells.get(ptyKey);
    if (!entry) return;
    remove(ptyKey);
    entry.pty.kill();
  };

  const startIdleTimer = (ptyKey: string, entry: ShellEntry): void => {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => kill(ptyKey), dependencies.idleTimeoutMs);
  };

  const send = (entry: ShellEntry, frame: Record<string, unknown>): void => {
    entry.socket?.send(JSON.stringify(frame));
  };

  return {
    create(sessionId, size) {
      const cwd = dependencies.resolveCwd(sessionId);
      if (cwd === null || !isDirectory(cwd)) {
        return { ok: false, status: 409, error: "Session folder not found" };
      }

      let pty: PtyProcess;
      try {
        pty = dependencies.spawn(dependencies.shell(), ["-l"], {
          name: TERMINAL_ENVIRONMENT.TERM,
          cols: size.cols,
          rows: size.rows,
          cwd,
          env: shellEnvironment(dependencies.environment()),
        });
      } catch {
        return { ok: false, status: 500, error: "Failed to start shell" };
      }

      const ptyKey = crypto.randomUUID();
      const entry: ShellEntry = { pty, buffered: "", socket: null, idleTimer: null };
      shells.set(ptyKey, entry);
      startIdleTimer(ptyKey, entry);

      pty.onData((data) => {
        entry.buffered = (entry.buffered + data).slice(-MAXIMUM_BUFFERED_OUTPUT);
        send(entry, { type: "data", data: encodeTerminalText(data) });
      });
      pty.onExit(({ exitCode, signal }) => {
        remove(ptyKey);
        send(entry, { type: "exit", exitCode, signal: signal ? signal : null });
        entry.socket?.close(1000, "shell exited");
        entry.socket = null;
      });
      return { ok: true, ptyKey };
    },

    attach(ptyKey, socket) {
      const entry = shells.get(ptyKey);
      if (!entry) return null;
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
      entry.socket?.close(4001, "shell attached elsewhere");
      entry.socket = socket;
      send(entry, { type: "opened", buffered: encodeTerminalText(entry.buffered) });

      return {
        input(message) {
          if (entry.socket !== socket || shells.get(ptyKey) !== entry) return;
          let frame;
          try {
            frame = parseShellClientFrame(message);
          } catch {
            socket.send(JSON.stringify({ type: "error", message: "Invalid shell frame" }));
            socket.close(1008, "invalid shell frame");
            return;
          }
          switch (frame.type) {
            case "data":
              entry.pty.write(decodeTerminalText(frame.data));
              return;
            case "resize":
              entry.pty.resize(frame.cols, frame.rows);
              return;
            case "close":
              entry.socket = null;
              kill(ptyKey);
              socket.close(1000, "shell closed");
          }
        },
        detach() {
          if (entry.socket !== socket) return;
          entry.socket = null;
          if (shells.get(ptyKey) === entry) startIdleTimer(ptyKey, entry);
        },
      };
    },

    busy(ptyKeys) {
      return ptyKeys.filter((ptyKey) => {
        const entry = shells.get(ptyKey);
        return entry !== undefined && dependencies.foregroundBusy(entry.pty.pid);
      });
    },

    shutdown() {
      for (const ptyKey of [...shells.keys()]) kill(ptyKey);
    },

    size: () => shells.size,
  };
}

/**
 * A job-control shell leads its own process group and hands the terminal to
 * each foreground job's group, so the shell is busy exactly when the
 * terminal's foreground group (`tpgid`) is not the shell's own (`pgid`).
 */
export function isForegroundBusy(pid: number): boolean {
  let output: string;
  try {
    output = execFileSync("ps", ["-o", "tpgid=,pgid=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    });
  } catch {
    return false;
  }
  const [foreground, own] = output.trim().split(/\s+/).map(Number);
  if (foreground === undefined || own === undefined) return false;
  return Number.isInteger(foreground) && foreground > 0 && foreground !== own;
}

const LOOPBACK_ADDRESS = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/i;

function isLoopbackAddress(address: string): boolean {
  return LOOPBACK_ADDRESS.test(address.trim());
}

/** The WebSocket peer check: fails closed when the runtime gives no address. */
export function isLoopbackPeer(address: string | undefined): boolean {
  return address !== undefined && isLoopbackAddress(address);
}

const LOCAL_ONLY = "Shell tabs are only available from this computer";

/**
 * A shell is a code-execution surface, so it is only served to this computer:
 * the peer must be loopback and so must every forwarding hop. The peer address
 * is srvx's `request.ip`. `vp dev` omits it on WebSocket upgrades, so the
 * socket route passes `peerCheckedLater` and checks the crossws peer address
 * in `open` instead; everywhere else a missing address is refused.
 */
function rejectNonLoopback(request: Request, peerCheckedLater: boolean): Response | null {
  const ip = (request as Request & { ip?: unknown }).ip;
  const forwarded = request.headers.get("X-Forwarded-For");
  const hops = forwarded === null ? [] : forwarded.split(",");
  const peerAllowed =
    typeof ip === "string" ? isLoopbackAddress(ip) : ip === undefined && peerCheckedLater;
  if (!peerAllowed || !hops.every(isLoopbackAddress)) {
    return Response.json({ error: LOCAL_ONLY }, { status: 403 });
  }
  return null;
}

function authorizeShellRequest(
  request: Request,
  enabled: () => boolean,
  peerCheckedLater: boolean,
): Response | null {
  if (!enabled()) {
    return Response.json({ error: "Shell tabs are disabled" }, { status: 403 });
  }
  return rejectCrossSite(request) ?? rejectNonLoopback(request, peerCheckedLater);
}

/** Upgrade gate for `/api/shell/$ptyKey`; pair it with `isLoopbackPeer` in `open`. */
export function authorizeShellSocket(
  request: Request,
  dependencies: { enabled: () => boolean } = { enabled: shellPaneEnabled },
): Response | null {
  return authorizeShellRequest(request, dependencies.enabled, true);
}

const CreateShellBodySchema = z
  .object({
    cols: z.number().int().positive().max(1000).default(80),
    rows: z.number().int().positive().max(1000).default(24),
  })
  .strict();

export async function handleCreateShellRequest(
  request: Request,
  sessionId: string,
  dependencies: {
    registry: Pick<ShellRegistry, "create">;
    enabled: () => boolean;
  } = { registry: getShellRegistry(), enabled: shellPaneEnabled },
): Promise<Response> {
  const rejection = authorizeShellRequest(request, dependencies.enabled, false);
  if (rejection) return rejection;

  const body = CreateShellBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid shell request" }, { status: 400 });

  const result = dependencies.registry.create(sessionId, body.data);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ptyKey: result.ptyKey });
}

const ShellBusyBodySchema = z.object({ ptyKeys: z.array(z.uuid()).max(64) }).strict();

/** `POST /api/shell-busy {ptyKeys}` → `{busy}`: which tabs would stop a command if closed. */
export async function handleShellBusyRequest(
  request: Request,
  dependencies: {
    registry: Pick<ShellRegistry, "busy">;
    enabled: () => boolean;
  } = { registry: getShellRegistry(), enabled: shellPaneEnabled },
): Promise<Response> {
  const rejection = authorizeShellRequest(request, dependencies.enabled, false);
  if (rejection) return rejection;

  const body = ShellBusyBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid shell request" }, { status: 400 });
  return Response.json({ busy: dependencies.registry.busy(body.data.ptyKeys) });
}

const SHELL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const REGISTRY_KEY = Symbol.for("claude-code-browser.shell-registry");

/**
 * The POST route and the WebSocket route can load this module in separate
 * module graphs during dev, so the live registry hangs off `globalThis`.
 */
export function getShellRegistry(): ShellRegistry {
  const holder = globalThis as typeof globalThis & { [REGISTRY_KEY]?: ShellRegistry };
  holder[REGISTRY_KEY] ??= createShellRegistry({
    resolveCwd: (sessionId) => getSessionDirectory(getDb().index, sessionId),
    shell: () => process.env["SHELL"] || "/bin/zsh",
    environment: () => process.env,
    spawn: spawnNodePty as SpawnPty,
    idleTimeoutMs: SHELL_IDLE_TIMEOUT_MS,
    foregroundBusy: isForegroundBusy,
  });
  return holder[REGISTRY_KEY];
}

export function stopAllShells(): void {
  const holder = globalThis as typeof globalThis & { [REGISTRY_KEY]?: ShellRegistry };
  holder[REGISTRY_KEY]?.shutdown();
}
