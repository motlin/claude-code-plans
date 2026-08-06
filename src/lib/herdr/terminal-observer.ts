import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { z } from "zod";
import { hmrDispose } from "../hmr-persist";
import { getHerdrPanes } from "./panes";
import { HerdrTerminalRecordSchema, type HerdrTerminalRecord } from "./terminal-protocol";

const MAXIMUM_LINE_BYTES = 5 * 1024 * 1024;
const ViewportDimensionSchema = z.number().int().positive().max(500);

type ObserverChild = ChildProcessByStdio<null, Readable, Readable>;
type SpawnObserver = (
  command: string,
  arguments_: readonly string[],
  options: { stdio: ["ignore", "pipe", "pipe"] },
) => ObserverChild;

export interface TerminalObserverSocket {
  send: (message: string) => void;
  close: (code?: number, reason?: string) => void;
}

interface ObserverOptions {
  target: string;
  columns: number;
  rows: number;
}

interface TerminalObserver {
  stop: () => void;
  shutdown: () => void;
}

interface RecordParser {
  push: (chunk: Buffer | string) => void;
  end: () => void;
}

export interface TerminalObserverDependencies {
  resolveTarget: (sessionId: string) => Promise<string>;
  spawnObserver: SpawnObserver;
}

function parseRecord(line: string): HerdrTerminalRecord {
  return HerdrTerminalRecordSchema.parse(JSON.parse(line));
}

export function createTerminalRecordParser(
  onRecord: (record: HerdrTerminalRecord) => void,
  onError: (error: Error) => void,
): RecordParser {
  let buffer = "";
  let stopped = false;

  const fail = (error: unknown): void => {
    if (stopped) return;
    stopped = true;
    onError(error instanceof Error ? error : new Error(String(error)));
  };

  return {
    push(chunk) {
      if (stopped) return;
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > MAXIMUM_LINE_BYTES && !buffer.includes("\n")) {
        fail(new Error("terminal observer record exceeds 5 MiB"));
        return;
      }

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1 && !stopped) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          try {
            onRecord(parseRecord(line));
          } catch (error) {
            fail(error);
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    },
    end() {
      if (!stopped && buffer.length > 0) {
        fail(new Error("terminal observer ended with an incomplete record"));
      }
    },
  };
}

const activeObservers = new Set<TerminalObserver>();

export function startTerminalObserver(
  options: ObserverOptions,
  socket: TerminalObserverSocket,
  spawnObserver: SpawnObserver = spawn,
): TerminalObserver {
  const columns = ViewportDimensionSchema.parse(options.columns);
  const rows = ViewportDimensionSchema.parse(options.rows);
  let stopped = false;
  let receivedClosed = false;
  let lastSequence: number | null = null;
  let standardError = "";

  const child = spawnObserver(
    "herdr",
    [
      "terminal",
      "session",
      "observe",
      options.target,
      "--cols",
      String(columns),
      "--rows",
      String(rows),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const observer: TerminalObserver = {
    stop() {
      if (stopped) return;
      stopped = true;
      activeObservers.delete(observer);
      child.stdout.off("data", onStandardOutput);
      child.stdout.off("end", onStandardOutputEnd);
      child.stderr.off("data", onStandardError);
      child.off("error", onChildError);
      child.off("exit", onChildExit);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    },
    shutdown() {
      if (stopped) return;
      socket.close(1012, "terminal observer server stopped");
      observer.stop();
    },
  };

  const fail = (message: string): void => {
    if (stopped) return;
    socket.send(JSON.stringify({ type: "observer.error", message }));
    socket.close(1011, "terminal observer failed");
    observer.stop();
  };

  const onRecord = (record: HerdrTerminalRecord): void => {
    if (record.type === "terminal.closed") {
      receivedClosed = true;
      socket.send(JSON.stringify(record));
      socket.close(1000, "terminal closed");
      observer.stop();
      return;
    }

    if (lastSequence === null && !record.full) {
      fail("terminal observer did not begin with a full keyframe");
      return;
    }
    if (lastSequence !== null && record.seq <= lastSequence) {
      fail("terminal frame sequence did not advance");
      return;
    }

    lastSequence = record.seq;
    socket.send(JSON.stringify(record));
  };

  const parser = createTerminalRecordParser(onRecord, (error) => fail(error.message));
  const onStandardOutput = (chunk: Buffer | string): void => parser.push(chunk);
  const onStandardOutputEnd = (): void => parser.end();
  const onStandardError = (chunk: Buffer | string): void => {
    standardError = `${standardError}${chunk.toString()}`.slice(-2000);
  };
  const onChildError = (error: Error): void => fail(error.message);
  const onChildExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (stopped || receivedClosed) return;
    const detail = standardError.trim() || `exit ${String(code)} signal ${String(signal)}`;
    fail(`herdr observer stopped before terminal.closed: ${detail}`);
  };

  child.stdout.on("data", onStandardOutput);
  child.stdout.on("end", onStandardOutputEnd);
  child.stderr.on("data", onStandardError);
  child.on("error", onChildError);
  child.on("exit", onChildExit);
  activeObservers.add(observer);
  return observer;
}

const defaultDependencies: TerminalObserverDependencies = {
  resolveTarget: async (sessionId) => {
    const pane = (await getHerdrPanes()).find((candidate) => candidate.sessionId === sessionId);
    if (!pane) throw new Error("No live herdr pane is linked to this session");
    return pane.terminalId;
  },
  spawnObserver: spawn,
};

export async function observeHerdrSession(
  sessionId: string,
  columns: number,
  rows: number,
  socket: TerminalObserverSocket,
  dependencies: TerminalObserverDependencies = defaultDependencies,
): Promise<TerminalObserver> {
  const target = await dependencies.resolveTarget(sessionId);
  return startTerminalObserver({ target, columns, rows }, socket, dependencies.spawnObserver);
}

export function stopAllTerminalObservers(): void {
  for (const observer of activeObservers) observer.shutdown();
}

hmrDispose(stopAllTerminalObservers);

export const __testing = {
  activeObserverCount: () => activeObservers.size,
};
