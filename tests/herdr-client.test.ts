import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { herdrRequest } from "../src/lib/herdr/client";

describe("herdrRequest", () => {
  const originalSocketPath = process.env["HERDR_SOCKET_PATH"];
  let directory: string;
  let server: Server | undefined;
  let socketPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "herdr-client-test-"));
    socketPath = join(directory, "herdr.sock");
    process.env["HERDR_SOCKET_PATH"] = socketPath;
  });

  afterEach(async () => {
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

  it("buffers a large response line and supplies omitted params", async () => {
    const receivedRequests: unknown[] = [];
    const content = "x".repeat(90 * 1024);
    await listen((socket) => {
      let requestBuffer = "";
      socket.on("data", (chunk) => {
        requestBuffer += chunk.toString();
        const newlineIndex = requestBuffer.indexOf("\n");
        if (newlineIndex === -1) return;
        receivedRequests.push(JSON.parse(requestBuffer.slice(0, newlineIndex)));

        const response = `${JSON.stringify({
          id: "response-100",
          result: { type: "snapshot", content },
        })}\n`;
        const splitIndex = 40 * 1024;
        socket.write(response.slice(0, splitIndex));
        setTimeout(() => socket.end(response.slice(splitIndex)), 5);
      });
    });

    const result = await herdrRequest<{ type: string; content: string }>({
      id: "request-100",
      method: "session.snapshot",
    });

    expect({ receivedRequests, result }).toStrictEqual({
      receivedRequests: [
        {
          id: "request-100",
          method: "session.snapshot",
          params: {},
        },
      ],
      result: {
        ok: true,
        value: { type: "snapshot", content },
      },
    });
  });

  it("returns the server error even when its response id is empty", async () => {
    await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          `${JSON.stringify({
            id: "",
            error: { code: "invalid_request", message: "invalid test request" },
          })}\n`,
        );
      });
    });

    await expect(
      herdrRequest({ id: "request-100", method: "ping", params: {} }),
    ).resolves.toStrictEqual({
      ok: false,
      code: "invalid_request",
      message: "invalid test request",
    });
  });

  it("uses a fresh connection for every request", async () => {
    let connectionCount = 0;
    await listen((socket) => {
      connectionCount += 1;
      socket.once("data", () => {
        socket.end(`${JSON.stringify({ id: "response-100", result: { type: "pong" } })}\n`);
      });
    });

    const results = await Promise.all([
      herdrRequest({ id: "request-100", method: "ping", params: {} }),
      herdrRequest({ id: "request-200", method: "ping", params: {} }),
    ]);

    expect({ connectionCount, results }).toStrictEqual({
      connectionCount: 2,
      results: [
        { ok: true, value: { type: "pong" } },
        { ok: true, value: { type: "pong" } },
      ],
    });
  });

  it("returns connect-failed when the socket is absent", async () => {
    const result = await herdrRequest({ id: "request-100", method: "ping", params: {} });
    if (result.ok) throw new Error("expected the request to fail");
    const { message, ...stableResult } = result;

    expect(stableResult).toStrictEqual({ ok: false, code: "connect-failed" });
    expect(typeof message).toBe("string");
  });

  it("returns bad-response for malformed JSON", async () => {
    await listen((socket) => {
      socket.once("data", () => socket.end("not-json\n"));
    });

    await expect(
      herdrRequest({ id: "request-100", method: "ping", params: {} }),
    ).resolves.toStrictEqual({
      ok: false,
      code: "bad-response",
      message: "herdr returned invalid JSON",
    });
  });

  it("returns closed when the server closes without a response", async () => {
    await listen((socket) => {
      socket.once("data", () => socket.end());
    });

    await expect(
      herdrRequest({ id: "request-100", method: "ping", params: {} }),
    ).resolves.toStrictEqual({
      ok: false,
      code: "closed",
      message: "herdr closed without a response",
    });
  });

  it("destroys the connection after a timeout", async () => {
    let connectionClosed: Promise<void> | undefined;
    await listen((socket) => {
      socket.on("error", () => undefined);
      connectionClosed = new Promise((resolve) => socket.once("close", resolve));
      socket.resume();
    });

    await expect(
      herdrRequest({ id: "request-100", method: "ping", params: {} }, 10),
    ).resolves.toStrictEqual({
      ok: false,
      code: "timeout",
      message: "herdr request timed out",
    });
    await connectionClosed;
  });
});
