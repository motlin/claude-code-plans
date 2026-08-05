import { existsSync } from "node:fs";
import { herdrRequest } from "./client";
import { resolveHerdrSocketPath } from "./socket-path";
import { hmrPersist } from "../hmr-persist";

export interface HerdrAvailability {
  available: boolean;
  socketPath: string;
  version?: string;
  protocol?: number;
  reason?: "no-socket" | "connect-failed" | "timeout" | "bad-response";
}

interface AvailabilityCache {
  expiresAt: number;
  pending: Promise<HerdrAvailability> | null;
  pendingSocketPath: string;
  result: HerdrAvailability | null;
}

const CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 1500;

const cache = hmrPersist<AvailabilityCache>("herdrAvailability", () => ({
  expiresAt: 0,
  pending: null,
  pendingSocketPath: "",
  result: null,
}));

function unavailable(
  socketPath: string,
  reason: NonNullable<HerdrAvailability["reason"]>,
): HerdrAvailability {
  return { available: false, socketPath, reason };
}

function resolvedSocketPath(): string {
  try {
    return resolveHerdrSocketPath();
  } catch {
    return "";
  }
}

async function runProbe(socketPath: string): Promise<HerdrAvailability> {
  if (!socketPath || !existsSync(socketPath)) return unavailable(socketPath, "no-socket");

  const response = await herdrRequest<unknown>(
    { id: "ccp:ping", method: "ping", params: {} },
    PROBE_TIMEOUT_MS,
  );
  if (!response.ok) {
    if (response.code === "connect-failed") return unavailable(socketPath, "connect-failed");
    if (response.code === "timeout") return unavailable(socketPath, "timeout");
    return unavailable(socketPath, "bad-response");
  }

  if (
    response.value === null ||
    typeof response.value !== "object" ||
    Array.isArray(response.value)
  ) {
    return unavailable(socketPath, "bad-response");
  }

  const result = response.value as Record<string, unknown>;
  if (
    result["type"] !== "pong" ||
    typeof result["version"] !== "string" ||
    typeof result["protocol"] !== "number" ||
    !Number.isInteger(result["protocol"]) ||
    result["protocol"] < 0
  ) {
    return unavailable(socketPath, "bad-response");
  }

  return {
    available: true,
    socketPath,
    version: result["version"],
    protocol: result["protocol"],
  };
}

/** Probe the local herdr API, caching availability for thirty seconds. */
export function probeHerdr(): Promise<HerdrAvailability> {
  const socketPath = resolvedSocketPath();
  const now = Date.now();
  if (cache.result?.socketPath === socketPath && now < cache.expiresAt) {
    return Promise.resolve(cache.result);
  }
  if (cache.pending && cache.pendingSocketPath === socketPath) return cache.pending;

  const pending = runProbe(socketPath)
    .catch(() => unavailable(socketPath, "connect-failed"))
    .then((result) => {
      cache.result = result;
      cache.expiresAt = Date.now() + CACHE_TTL_MS;
      if (cache.pending === pending) {
        cache.pending = null;
        cache.pendingSocketPath = "";
      }
      return result;
    });
  cache.pending = pending;
  cache.pendingSocketPath = socketPath;
  return pending;
}

export const __testing = {
  clearCache: (): void => {
    cache.expiresAt = 0;
    cache.pending = null;
    cache.pendingSocketPath = "";
    cache.result = null;
  },
};
