// In dev, nitro forwards each request to the server environments loaded in its env-runner worker. Until an
// environment's entry module has finished loading (startup, and again after every vite restart, which builds a
// fresh worker that may also wait on a dependency re-optimise), nitro polls for about three seconds and then throws
// `NitroViteError: Vite environment "nitro" is unavailable` from the worker's fetch handler. Nothing catches that
// rejection: the worker logs it with a stack, and the request is never answered.
//
// The entries announce themselves over their environment's hot channel once loaded. Until every environment has,
// requests wait here on the host instead of reaching the worker, and any still waiting after the timeout get a
// quiet 503 with Retry-After that the client's retries and SSE reconnect back off on.

export const DEV_ENV_READY_EVENT = "ccp:dev-env-ready";
export const DEV_ENV_READY_QUERY = "ccp:dev-env-ready?";

const SERVER_ENVIRONMENTS = ["nitro", "ssr"] as const;
const DEFAULT_TIMEOUT_MS = 15_000;

interface HotChannelLike {
	send(event: string): void;
	on(event: string, listener: () => void): void;
}

interface NitroEnvironmentLike {
	hot: HotChannelLike;
	dispatchFetch(request: Request): Promise<Response>;
}

interface DevServerLike {
	environments: {nitro?: NitroEnvironmentLike; ssr?: {hot: HotChannelLike}};
}

interface DevPlugin {
	name: string;
	apply: "serve";
	configureServer(server: DevServerLike): void;
}

/**
 * Call from module scope at the end of a server environment's entry: tells the dev server the entry has loaded,
 * and answers when a dev server that started listening later asks. A no-op outside dev, where there is no hot channel.
 */
export function announceDevEnvReady(hot: HotChannelLike | undefined): void {
	if (hot === undefined) return;
	hot.send(DEV_ENV_READY_EVENT);
	hot.on(DEV_ENV_READY_QUERY, () => hot.send(DEV_ENV_READY_EVENT));
}

/** {@link announceDevEnvReady} for whichever server environment loaded this module; each loads its own copy. */
export function announceThisDevEnvReady(): void {
	announceDevEnvReady(import.meta.hot);
}

function unavailable(): Response {
	return new Response("Dev server is starting; retry shortly.\n", {
		status: 503,
		headers: {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "1"},
	});
}

/** Holds requests bound for nitro's worker until every server environment's entry has loaded. */
export function holdNitroRequestsUntilReady({timeoutMs = DEFAULT_TIMEOUT_MS}: {timeoutMs?: number} = {}): DevPlugin {
	return {
		name: "ccp:hold-nitro-requests-until-ready",
		apply: "serve",
		configureServer(server) {
			const nitro = server.environments.nitro;
			if (nitro === undefined) return;

			const waiting = new Set<string>();
			let opened: () => void = () => {};
			const ready = new Promise<void>((resolve) => {
				opened = resolve;
			});
			for (const name of SERVER_ENVIRONMENTS) {
				const hot = server.environments[name]?.hot;
				if (hot === undefined) continue;
				waiting.add(name);
				hot.on(DEV_ENV_READY_EVENT, () => {
					waiting.delete(name);
					if (waiting.size === 0) opened();
				});
				hot.send(DEV_ENV_READY_QUERY);
			}

			// After one timeout, stop holding: if an announcement was missed (or the entry failed to load, which
			// nitro reports itself), waiting longer would only put every request behind the same timeout.
			let gaveUp = false;
			const dispatchFetch = nitro.dispatchFetch.bind(nitro);
			nitro.dispatchFetch = async (request) => {
				if (waiting.size > 0 && !gaveUp) {
					let timer: ReturnType<typeof setTimeout> | undefined;
					const timedOut = new Promise<true>((resolve) => {
						timer = setTimeout(() => resolve(true), timeoutMs);
					});
					const timeout = await Promise.race([ready.then(() => false), timedOut]);
					clearTimeout(timer);
					if (timeout) {
						gaveUp = true;
						return unavailable();
					}
				}
				return dispatchFetch(request);
			};
		},
	};
}
