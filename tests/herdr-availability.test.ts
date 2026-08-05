import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { __testing, probeHerdr } from "../src/lib/herdr/availability";

describe("probeHerdr", () => {
  const originalSocketPath = process.env["HERDR_SOCKET_PATH"];
  let directory: string;
  let server: Server | undefined;
  let socketPath: string;

  beforeEach(() => {
    __testing.clearCache();
    directory = mkdtempSync(join(tmpdir(), "herdr-availability-test-"));
    socketPath = join(directory, "herdr.sock");
    process.env["HERDR_SOCKET_PATH"] = socketPath;
  });

  afterEach(async () => {
    __testing.clearCache();
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
    rmSync(directory, { recursive: true, force: true });
    if (originalSocketPath === undefined) {
      delete process.env["HERDR_SOCKET_PATH"];
    } else {
      process.env["HERDR_SOCKET_PATH"] = originalSocketPath;
    }
  });

  async function listen(connectionHandler: (socket: Socket) => void): Promise<void> {
    const candidate = createServer(connectionHandler);
    await new Promise<void>((resolve, reject) => {
      candidate.once("error", reject);
      candidate.listen(socketPath, () => {
        candidate.off("error", reject);
        resolve();
      });
    });
    server = candidate;
  }

  it("reports a missing socket without throwing", async () => {
    await expect(probeHerdr()).resolves.toStrictEqual({
      available: false,
      socketPath,
      reason: "no-socket",
    });
  });

  it("returns pong metadata and caches rapid probes", async () => {
    let connectionCount = 0;
    const receivedRequests: unknown[] = [];
    await listen((socket) => {
      connectionCount += 1;
      socket.once("data", (chunk) => {
        receivedRequests.push(JSON.parse(chunk.toString().trimEnd()));
        socket.end(
          `${JSON.stringify({
            id: "ccp:ping",
            result: {
              type: "pong",
              version: "99.0.0-test",
              protocol: 100,
              capabilities: ["test-capability"],
            },
          })}\n`,
        );
      });
    });

    const first = await probeHerdr();
    const second = await probeHerdr();

    expect({ connectionCount, receivedRequests, first, second }).toStrictEqual({
      connectionCount: 1,
      receivedRequests: [{ id: "ccp:ping", method: "ping", params: {} }],
      first: {
        available: true,
        socketPath,
        version: "99.0.0-test",
        protocol: 100,
      },
      second: {
        available: true,
        socketPath,
        version: "99.0.0-test",
        protocol: 100,
      },
    });
  });

  it("rejects a malformed pong as a bad response", async () => {
    await listen((socket) => {
      socket.once("data", () => {
        socket.end(`${JSON.stringify({ id: "ccp:ping", result: { type: "pong" } })}\n`);
      });
    });

    await expect(probeHerdr()).resolves.toStrictEqual({
      available: false,
      socketPath,
      reason: "bad-response",
    });
  });
});
