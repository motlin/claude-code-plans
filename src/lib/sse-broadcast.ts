import {SSE_EVENTS} from "./hook-events";
import {hmrDispose, hmrPersist} from "./hmr-persist";

// Persisted across HMR reloads so reconnecting clients aren't dropped
// during dev hot-swaps of the watcher module.
const clients = hmrPersist("watcherClients", () => new Set<ReadableStreamDefaultController>());

const encoder = new TextEncoder();

/**
 * Per-stream queue budget for `/api/events`. A client that is merely slow (a
 * phone link, a throttled background tab) dips below it briefly and drains.
 */
export const SSE_HIGH_WATER_MARK_BYTES = 1024 * 1024;

/**
 * How long a client's queue may stay at or over its high-water mark before it
 * is dropped. Generous so only a stalled reader (half-open TCP, frozen tab) is
 * cut; the browser's EventSource reconnects and the app refetches.
 */
export const SSE_STALL_DROP_MS = 2 * 60_000;

// When each client's queue was first seen full, cleared once it drains.
const fullSince = new WeakMap<ReadableStreamDefaultController, number>();

/** Drop `client` if its queue has stayed full for the stall window. */
function dropIfStalled(client: ReadableStreamDefaultController, now: number): boolean
{
	const {desiredSize} = client;
	if (typeof desiredSize !== "number" || desiredSize > 0)
	{
		fullSince.delete(client);
		return false;
	}
	const since = fullSince.get(client);
	if (since === undefined)
	{
		fullSince.set(client, now);
		return false;
	}
	if (now - since < SSE_STALL_DROP_MS) return false;
	clients.delete(client);
	fullSince.delete(client);
	try
	{
		// error() discards the queued backlog at once; close() would wait for it to drain.
		client.error(new Error("SSE client stalled"));
	}
	catch
	{
		// already errored or closed
	}
	return true;
}

export interface SseTypeStats
{
	events: number;
	payloadBytes: number;
	/** Payload bytes times the clients that accepted them. */
	deliveredBytes: number;
}

const stats = new Map<string, SseTypeStats>();

const SSE_STATS_LOG_INTERVAL_MS = 60_000;
let statsLogTimer: ReturnType<typeof setInterval> | undefined;
let lastLogged = new Map<string, SseTypeStats>();

export function getSseStats(): Record<string, SseTypeStats>
{
	return Object.fromEntries(
		[...stats].map(([type, entry]) => [
			type,
			{
				...entry,
			},
		]),
	);
}

export function resetSseStats(): void
{
	stats.clear();
	lastLogged = new Map();
}

function logSseStatsWindow(): void
{
	const types: Record<string, SseTypeStats> = {};
	for (const [type, entry] of stats)
	{
		const previous = lastLogged.get(type);
		const events = entry.events - (previous?.events ?? 0);
		if (events === 0) continue;
		types[type] =
		{
			events,
			payloadBytes: entry.payloadBytes - (previous?.payloadBytes ?? 0),
			deliveredBytes: entry.deliveredBytes - (previous?.deliveredBytes ?? 0),
		};
	}
	lastLogged = new Map(
		[...stats].map(([type, entry]) => [
			type,
			{
				...entry,
			},
		]),
	);
	if (Object.keys(types).length === 0) return;
	console.log(
		JSON.stringify(
			{
				perf: "sse",
				windowMs: SSE_STATS_LOG_INTERVAL_MS,
				clients: clients.size,
				types,
			},
		),
	);
}

function ensureStatsLog(): void
{
	if (statsLogTimer || process.env["CCB_PERF_LOG"] !== "1") return;
	statsLogTimer = setInterval(logSseStatsWindow, SSE_STATS_LOG_INTERVAL_MS);
	statsLogTimer.unref();
}

export function stopSseStatsLog(): void
{
	clearInterval(statsLogTimer);
	statsLogTimer = undefined;
}

hmrDispose(stopSseStatsLog);

export function broadcastTyped(type: string, data: Record<string, unknown>): void
{
	ensureStatsLog();
	const payload = encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	let delivered = 0;
	const now = Date.now();
	for (const client of clients)
	{
		if (dropIfStalled(client, now)) continue;
		try
		{
			client.enqueue(payload);
			delivered++;
		}
		catch
		{
			clients.delete(client);
		}
	}
	const entry = stats.get(type) ??
	{
		events: 0,
		payloadBytes: 0,
		deliveredBytes: 0,
	};
	entry.events++;
	entry.payloadBytes += payload.byteLength;
	entry.deliveredBytes += payload.byteLength * delivered;
	stats.set(type, entry);
}

export function broadcast(): void
{
	broadcastTyped(SSE_EVENTS.CONTENT_UPDATED, {});
}

export function addClient(controller: ReadableStreamDefaultController): void
{
	clients.add(controller);
}

export function removeClient(controller: ReadableStreamDefaultController): void
{
	clients.delete(controller);
}

/** Number of SSE clients currently subscribed to `/api/events`. */
export function sseClientCount(): number
{
	return clients.size;
}
