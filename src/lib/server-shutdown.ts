import {randomUUID} from "node:crypto";
import {BroadcastChannel} from "node:worker_threads";
import {z} from "zod";
import {isRecord} from "./narrow";

type ShutdownHook = () => void | Promise<void>;

// Nitro plugins and the SSR entry (src/server.ts) are bundled separately, so
// each gets its own copy of this module. The registry lives on globalThis so
// hooks registered by the SSR entry run from the Nitro plugin's close hook.
const REGISTRY = Symbol.for("claude-code-browser.server-shutdown-hooks");

/** Only this module's copies write the registry slot, so a Set there holds shutdown hooks. */
function isHookRegistry(value: unknown): value is Set<ShutdownHook>
{
	return value instanceof Set;
}

function hooks(): Set<ShutdownHook>
{
	const existing: unknown = Reflect.get(globalThis, REGISTRY);
	if (isHookRegistry(existing)) return existing;
	const created = new Set<ShutdownHook>();
	Reflect.set(globalThis, REGISTRY, created);
	return created;
}

/** Register cleanup that releases a long-lived handle when the server shuts down. */
export function onServerShutdown(hook: ShutdownHook): () => void
{
	hooks().add(hook);
	return () =>
	{
		hooks().delete(hook);
	};
}

/** Unregister every hook, handing them back to run. */
function takeHooks(): ShutdownHook[]
{
	const taken = [...hooks()];
	hooks().clear();
	return taken;
}

/** Run every given hook; a failing hook never skips the others. */
async function runHooks(pending: readonly ShutdownHook[]): Promise<void>
{
	const results = await Promise.allSettled(pending.map(async (hook) => hook()));
	for (const result of results)
	{
		if (result.status === "rejected") console.error("Server shutdown hook failed:", result.reason);
	}
}

/** Run and forget every registered hook; a failing hook never skips the others. */
export async function runServerShutdownHooks(): Promise<void>
{
	await runHooks(takeHooks());
}

// In dev, a vite restart starts the SSR entry in a fresh worker thread and never
// closes the previous one, so its watcher, timers, initial scan and database
// connection keep running beside the new instance and contend for the SQLite
// write lock. Worker threads share no globals, but a BroadcastChannel reaches
// every thread in the process.
const TAKEOVER_CHANNEL = "claude-code-browser.server-takeover";
const DEFAULT_ACK_WINDOW_MS = 250;
const DEFAULT_RELEASE_TIMEOUT_MS = 15_000;

const TakeoverMessageSchema = z.discriminatedUnion("type", [
	z.strictObject(
		{
			type: z.literal("takeover"),
			requestId: z.string(),
		},
	),
	z.strictObject(
		{
			type: z.literal(["stopping", "released"]),
			requestId: z.string(),
			instanceId: z.string(),
		},
	),
]);
type TakeoverMessage = z.infer<typeof TakeoverMessageSchema>;

/** The takeover message a channel event carries, or undefined for anything else. */
function takeoverMessage(event: unknown): TakeoverMessage | undefined
{
	return TakeoverMessageSchema.safeParse(isRecord(event) ? event["data"] : undefined).data;
}

function openTakeoverChannel(): BroadcastChannel
{
	const channel = new BroadcastChannel(TAKEOVER_CHANNEL);
	channel.unref();
	return channel;
}

/**
 * Tear down with `teardown` the first time another instance requests a
 * takeover, acknowledging it before and after. Returns a function that stops
 * listening.
 */
export function listenForTakeover(teardown: ShutdownHook): () => void
{
	const channel = openTakeoverChannel();
	const instanceId = randomUUID();
	let done = false;
	channel.onmessage = (event) =>
	{
		const message = takeoverMessage(event);
		if (done || message?.type !== "takeover") return;
		done = true;
		const {requestId} = message;
		channel.postMessage(
			{
				type: "stopping",
				requestId,
				instanceId,
			} satisfies TakeoverMessage,
		);
		void (async () =>
		{
			try
			{
				await teardown();
			}
			catch (err)
			{
				console.error("Server takeover teardown failed:", err);
			}
			channel.postMessage(
				{
					type: "released",
					requestId,
					instanceId,
				} satisfies TakeoverMessage,
			);
			channel.close();
		})();
	};
	return () =>
	{
		if (done) return;
		done = true;
		channel.close();
	};
}

/**
 * Ask every other server instance in this process to tear down, and wait until
 * each one that answers within `ackWindowMs` has released its handles. Rejects
 * if one is still holding them after `releaseTimeoutMs`: the caller must not
 * open the databases while it may still hold the write lock.
 */
export async function requestTakeover({
	ackWindowMs = DEFAULT_ACK_WINDOW_MS,
	releaseTimeoutMs = DEFAULT_RELEASE_TIMEOUT_MS,
}:
{
	ackWindowMs?: number;
	releaseTimeoutMs?: number;
} = {}): Promise<void>
{
	const channel = openTakeoverChannel();
	const requestId = randomUUID();
	const stopping = new Set<string>();
	const released = new Set<string>();
	return new Promise((resolve, reject) =>
	{
		let windowClosed = false;
		const close = () =>
		{
			clearTimeout(windowTimer);
			clearTimeout(releaseTimer);
			channel.close();
		};
		const finish = () =>
		{
			close();
			resolve();
		};
		const finishIfReleased = () =>
		{
			if (windowClosed && [...stopping].every((id) => released.has(id))) finish();
		};
		channel.onmessage = (event) =>
		{
			const message = takeoverMessage(event);
			if (message === undefined || message.type === "takeover" || message.requestId !== requestId) return;
			stopping.add(message.instanceId);
			if (message.type === "released") released.add(message.instanceId);
			finishIfReleased();
		};
		const windowTimer = setTimeout(() =>
		{
			windowClosed = true;
			finishIfReleased();
		}, ackWindowMs);
		const releaseTimer = setTimeout(() =>
		{
			close();
			reject(
				new Error(
					`The previous server instance did not release its databases within ${releaseTimeoutMs}ms; refusing to open them alongside it`,
				),
			);
		}, releaseTimeoutMs);
		channel.postMessage(
			{
				type: "takeover",
				requestId,
			} satisfies TakeoverMessage,
		);
	});
}

/**
 * Register this server instance's cleanup after tearing down any previous
 * instance: hooks left in this thread's registry by an earlier evaluation of
 * the SSR entry, and instances in other worker threads. When a later instance
 * requests a takeover, this one runs its own hooks.
 *
 * Rejects when an instance in another thread never releases its handles.
 *
 * The hook is registered at once, so a shutdown that begins mid-takeover still
 * runs it. The returned signal aborts when the hook starts: startup that is
 * still running must check it after every step and stop, releasing anything
 * it created after the hook ran.
 */
export async function takeOverServerShutdown(hook: ShutdownHook): Promise<AbortSignal>
{
	const previous = takeHooks();
	const stopping = new AbortController();
	onServerShutdown(async () =>
	{
		stopping.abort();
		await hook();
	});
	await runHooks(previous);
	await requestTakeover();
	if (!stopping.signal.aborted) onServerShutdown(listenForTakeover(runServerShutdownHooks));
	return stopping.signal;
}

// The SSR entry sets the hold, but the WebSocket routes are Nitro routes in
// another bundle, so the hold lives on globalThis like the hook registry.
const REQUEST_HOLD = Symbol.for("claude-code-browser.request-hold");
// Releases the placeholder hold expectRequestHold installed, once the SSR entry's hold replaces it.
const REQUEST_HOLD_RELEASE = Symbol.for("claude-code-browser.request-hold-release");

/** Only this module writes the hold slot, so a Promise there is the hold. */
function isRequestHold(value: unknown): value is Promise<void>
{
	return value instanceof Promise;
}

function isHoldRelease(value: unknown): value is (hold: Promise<void>) => void
{
	return typeof value === "function";
}

/**
 * Holds requests until the SSR entry calls {@link holdRequestsUntil}. In dev,
 * WebSocket upgrades bypass the dev server's request gate and can reach the
 * Nitro routes before the SSR entry has loaded and set its hold, so they
 * would open the databases while the previous instance may still hold them.
 * A no-op once a hold is set.
 */
export function expectRequestHold(): void
{
	if (isRequestHold(Reflect.get(globalThis, REQUEST_HOLD))) return;
	const placeholder = new Promise<void>((resolve) =>
	{
		Reflect.set(globalThis, REQUEST_HOLD_RELEASE, (hold: Promise<void>) =>
		{
			resolve(hold);
		});
	});
	Reflect.set(globalThis, REQUEST_HOLD, placeholder);
}

/**
 * Resolves once requests held by {@link holdRequestsUntil} may proceed, at
 * once when nothing holds them. Routes outside the SSR entry's fetch (the
 * WebSocket upgrades) await it before touching the databases.
 */
export async function requestsReleased(): Promise<void>
{
	const hold: unknown = Reflect.get(globalThis, REQUEST_HOLD);
	if (isRequestHold(hold)) await hold;
}

/**
 * Hold each request until `ready` settles: a request served during the
 * takeover would open the databases while the previous instance may still
 * hold them. A failed startup lets requests through, to fail on their own.
 * {@link requestsReleased} waits for the same hold, including callers already
 * waiting on {@link expectRequestHold}'s placeholder.
 */
export function holdRequestsUntil<R>(
	ready: Promise<unknown>,
	fetch: (request: Request) => R | Promise<R>,
): (request: Request) => Promise<R>
{
	const settled = ready.then(
		() => {},
		() => {},
	);
	Reflect.set(globalThis, REQUEST_HOLD, settled);
	const release: unknown = Reflect.get(globalThis, REQUEST_HOLD_RELEASE);
	Reflect.deleteProperty(globalThis, REQUEST_HOLD_RELEASE);
	if (isHoldRelease(release)) release(settled);
	return async (request) =>
	{
		await settled;
		return fetch(request);
	};
}
