import {randomUUID} from "node:crypto";
import {BroadcastChannel} from "node:worker_threads";

type ShutdownHook = () => void | Promise<void>;

// Nitro plugins and the SSR entry (src/server.ts) are bundled separately, so
// each gets its own copy of this module. The registry lives on globalThis so
// hooks registered by the SSR entry run from the Nitro plugin's close hook.
const REGISTRY = Symbol.for("claude-code-browser.server-shutdown-hooks");

function hooks(): Set<ShutdownHook> {
	const holder = globalThis as {[REGISTRY]?: Set<ShutdownHook>};
	return (holder[REGISTRY] ??= new Set());
}

/** Register cleanup that releases a long-lived handle when the server shuts down. */
export function onServerShutdown(hook: ShutdownHook): () => void {
	hooks().add(hook);
	return () => {
		hooks().delete(hook);
	};
}

/** Run and forget every registered hook; a failing hook never skips the others. */
export async function runServerShutdownHooks(): Promise<void> {
	const pending = [...hooks()];
	hooks().clear();
	const results = await Promise.allSettled(pending.map(async (hook) => hook()));
	for (const result of results) {
		if (result.status === "rejected") console.error("Server shutdown hook failed:", result.reason);
	}
}

// In dev, a vite restart starts the SSR entry in a fresh worker thread and never
// closes the previous one, so its watcher, timers, initial scan and database
// connection keep running beside the new instance and contend for the SQLite
// write lock. Worker threads share no globals, but a BroadcastChannel reaches
// every thread in the process.
const TAKEOVER_CHANNEL = "claude-code-browser.server-takeover";
const DEFAULT_ACK_WINDOW_MS = 250;
const DEFAULT_RELEASE_TIMEOUT_MS = 15_000;

type TakeoverMessage =
	| {type: "takeover"; requestId: string}
	| {type: "stopping" | "released"; requestId: string; instanceId: string};

function openTakeoverChannel(): BroadcastChannel {
	const channel = new BroadcastChannel(TAKEOVER_CHANNEL);
	channel.unref();
	return channel;
}

/**
 * Tear down with `teardown` the first time another instance requests a
 * takeover, acknowledging it before and after. Returns a function that stops
 * listening.
 */
export function listenForTakeover(teardown: ShutdownHook): () => void {
	const channel = openTakeoverChannel();
	const instanceId = randomUUID();
	let done = false;
	channel.onmessage = (event) => {
		const message = (event as MessageEvent<TakeoverMessage>).data;
		if (done || message.type !== "takeover") return;
		done = true;
		const {requestId} = message;
		channel.postMessage({type: "stopping", requestId, instanceId} satisfies TakeoverMessage);
		void (async () => {
			try {
				await teardown();
			} catch (err) {
				console.error("Server takeover teardown failed:", err);
			}
			channel.postMessage({type: "released", requestId, instanceId} satisfies TakeoverMessage);
			channel.close();
		})();
	};
	return () => {
		if (done) return;
		done = true;
		channel.close();
	};
}

/**
 * Ask every other server instance in this process to tear down, and wait until
 * each one that answers within `ackWindowMs` has released its handles.
 */
export function requestTakeover({
	ackWindowMs = DEFAULT_ACK_WINDOW_MS,
	releaseTimeoutMs = DEFAULT_RELEASE_TIMEOUT_MS,
}: {ackWindowMs?: number; releaseTimeoutMs?: number} = {}): Promise<void> {
	const channel = openTakeoverChannel();
	const requestId = randomUUID();
	const stopping = new Set<string>();
	const released = new Set<string>();
	return new Promise((resolve) => {
		let windowClosed = false;
		const finish = () => {
			clearTimeout(windowTimer);
			clearTimeout(releaseTimer);
			channel.close();
			resolve();
		};
		const finishIfReleased = () => {
			if (windowClosed && [...stopping].every((id) => released.has(id))) finish();
		};
		channel.onmessage = (event) => {
			const message = (event as MessageEvent<TakeoverMessage>).data;
			if (message.type === "takeover" || message.requestId !== requestId) return;
			stopping.add(message.instanceId);
			if (message.type === "released") released.add(message.instanceId);
			finishIfReleased();
		};
		const windowTimer = setTimeout(() => {
			windowClosed = true;
			finishIfReleased();
		}, ackWindowMs);
		const releaseTimer = setTimeout(() => {
			console.error("Timed out waiting for the previous server instance to shut down");
			finish();
		}, releaseTimeoutMs);
		channel.postMessage({type: "takeover", requestId} satisfies TakeoverMessage);
	});
}

/**
 * Register this server instance's cleanup after tearing down any previous
 * instance: hooks left in this thread's registry by an earlier evaluation of
 * the SSR entry, and instances in other worker threads. When a later instance
 * requests a takeover, this one runs its own hooks.
 */
export async function takeOverServerShutdown(hook: ShutdownHook): Promise<void> {
	await runServerShutdownHooks();
	await requestTakeover();
	onServerShutdown(hook);
	onServerShutdown(listenForTakeover(runServerShutdownHooks));
}
