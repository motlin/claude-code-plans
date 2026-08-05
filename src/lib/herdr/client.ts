import { createConnection, type Socket } from "node:net";
import { resolveHerdrSocketPath } from "./socket-path";

export type HerdrResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

const MAXIMUM_REQUEST_BYTES = 1024 * 1024;

function failure(code: string, message: string): HerdrResult<never> {
  return { ok: false, code, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serializeRequest(request: object): HerdrResult<string> {
  const fields = request as Record<string, unknown>;
  if (typeof fields["id"] !== "string") {
    return failure("invalid-request", "herdr request id must be a string");
  }
  if (typeof fields["method"] !== "string") {
    return failure("invalid-request", "herdr request method must be a string");
  }

  const params = Object.hasOwn(fields, "params") ? fields["params"] : {};
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return failure("invalid-request", "herdr request params must be an object");
  }

  let line: string;
  try {
    line = `${JSON.stringify({ ...fields, params })}\n`;
  } catch (error) {
    return failure("invalid-request", errorMessage(error));
  }

  if (Buffer.byteLength(line) > MAXIMUM_REQUEST_BYTES) {
    return failure("request-too-large", "herdr requests cannot exceed 1 MiB");
  }

  return { ok: true, value: line };
}

function parseResponse<T>(line: string): HerdrResult<T> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return failure("bad-response", "herdr returned invalid JSON");
  }

  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return failure("bad-response", "herdr returned an invalid response envelope");
  }

  const fields = message as Record<string, unknown>;
  if (Object.hasOwn(fields, "result")) {
    return { ok: true, value: fields["result"] as T };
  }
  if (Object.hasOwn(fields, "error")) {
    const responseError = fields["error"];
    if (
      responseError !== null &&
      typeof responseError === "object" &&
      !Array.isArray(responseError)
    ) {
      const errorFields = responseError as Record<string, unknown>;
      if (typeof errorFields["code"] === "string" && typeof errorFields["message"] === "string") {
        return failure(errorFields["code"], errorFields["message"]);
      }
    }
  }

  return failure("bad-response", "herdr returned an invalid response envelope");
}

/**
 * Send one newline-delimited JSON request over a fresh herdr API connection.
 *
 * The server closes ordinary connections after one response. Its response id
 * may also be empty after a deserialization error, so the connection itself is
 * the correlation boundary.
 */
export function herdrRequest<T>(request: object, timeoutMs = 5000): Promise<HerdrResult<T>> {
  const serializedRequest = serializeRequest(request);
  if (!serializedRequest.ok) return Promise.resolve(serializedRequest);

  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    let socket: Socket | undefined;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (result: HerdrResult<T>) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (socket) {
        socket.off("connect", onConnect);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
        socket.destroy();
      }
      resolve(result);
    };

    const onConnect = () => {
      socket?.write(serializedRequest.value);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      finish(parseResponse<T>(buffer.slice(0, newlineIndex)));
    };
    const onError = (error: Error) => {
      finish(failure("connect-failed", error.message));
    };
    const onClose = () => {
      finish(failure("closed", "herdr closed without a response"));
    };

    try {
      socket = createConnection(resolveHerdrSocketPath());
      socket.setEncoding("utf8");
      socket.on("connect", onConnect);
      socket.on("data", onData);
      socket.on("error", onError);
      socket.on("close", onClose);
      timeout = setTimeout(() => {
        finish(failure("timeout", "herdr request timed out"));
      }, timeoutMs);
    } catch (error) {
      finish(failure("connect-failed", errorMessage(error)));
    }
  });
}
