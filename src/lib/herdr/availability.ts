import {existsSync} from "node:fs";
import {herdrRequest} from "./client";
import {resolveHerdrSocketPath} from "./socket-path";
import {hmrPersist} from "../hmr-persist";
import {asRecord} from "../narrow";

export interface HerdrAvailability {
	available: boolean;
	socketPath: string;
	version?: string;
	protocol?: number;
	reason?: "no-socket" | "connect-failed" | "timeout" | "bad-response";
}

interface AvailabilityCacheEntry {
	expiresAt: number;
	pending: Promise<HerdrAvailability> | null;
	result: HerdrAvailability | null;
}

const CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 1500;

/** One entry per probed socket path. */
const cache = hmrPersist<Map<string, AvailabilityCacheEntry>>("herdrAvailabilityBySocket", () => new Map());

function unavailable(socketPath: string, reason: NonNullable<HerdrAvailability["reason"]>): HerdrAvailability {
	return {available: false, socketPath, reason};
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

	const response = await herdrRequest({id: "ccp:ping", method: "ping", params: {}}, PROBE_TIMEOUT_MS, socketPath);
	if (!response.ok) {
		if (response.code === "connect-failed") return unavailable(socketPath, "connect-failed");
		if (response.code === "timeout") return unavailable(socketPath, "timeout");
		return unavailable(socketPath, "bad-response");
	}

	const result = asRecord(response.value);
	if (
		result === undefined ||
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

/** Probe one herdr server's API socket, uncached. */
export async function probeHerdrSocket(socketPath: string): Promise<HerdrAvailability> {
	return runProbe(socketPath).catch(() => unavailable(socketPath, "connect-failed"));
}

/** Probe a herdr API socket (the default one when omitted), caching availability for thirty seconds. */
export async function probeHerdr(socketPath: string = resolvedSocketPath()): Promise<HerdrAvailability> {
	const entry = cache.get(socketPath) ?? {expiresAt: 0, pending: null, result: null};
	cache.set(socketPath, entry);
	if (entry.result !== null && Date.now() < entry.expiresAt) return Promise.resolve(entry.result);
	if (entry.pending) return entry.pending;

	const pending = probeHerdrSocket(socketPath).then((result) => {
		entry.result = result;
		entry.expiresAt = Date.now() + CACHE_TTL_MS;
		if (entry.pending === pending) entry.pending = null;
		return result;
	});
	entry.pending = pending;
	return pending;
}

/**
 * Whether any herdr server answers: the default one or a named session, so a
 * herdr running only as `herdr --session <name>` still counts as available.
 */
export async function probeAnyHerdr(
	socketPaths: readonly string[],
	probe: (socketPath: string) => Promise<HerdrAvailability> = probeHerdr,
): Promise<boolean> {
	const results = await Promise.all(socketPaths.map(probe));
	return results.some((result) => result.available);
}

export const __testing = {
	clearCache: (): void => {
		cache.clear();
	},
};
