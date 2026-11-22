// In dev, nitro forwards each request to the server environments loaded in its env-runner worker. Until an
// environment's entry module has finished loading (startup, and again after every vite restart, which builds a
// fresh worker that may also wait on a dependency re-optimise), nitro polls for about three seconds and then throws
// `NitroViteError: Vite environment "nitro" is unavailable` from the worker's fetch handler. Nothing catches that
// rejection: the worker logs it with a stack, and the request is never answered.
//
// The entries announce themselves over their environment's hot channel once loaded. Until every environment has,
// requests wait here on the host instead of reaching the worker, and any still waiting after the timeout get a
// quiet 503 with Retry-After that the client's retries and SSE reconnect back off on.
//
// WebSocket upgrades skip dispatchFetch: nitro hands them to its env runner's upgrade(), which proxies them to the
// worker as soon as the worker listens. The worker's upgrade handler silently drops any upgrade that arrives before
// the nitro entry has loaded (it neither answers nor closes the socket), so a socket opened in that window, which a
// vite restart reopens every time, hung until the client gave up. Upgrades wait on the same gate, and one still
// waiting after the timeout is refused with the same 503.

export const DEV_ENV_READY_EVENT = "ccp:dev-env-ready";
export const DEV_ENV_READY_QUERY = "ccp:dev-env-ready?";

const SERVER_ENVIRONMENTS = ["nitro", "ssr"] as const;
const DEFAULT_TIMEOUT_MS = 15_000;

interface HotChannelLike
{
	send(event: string): void;
	on(event: string, listener: () => void): void;
}

interface UpgradeContext
{
	node:
	{
		socket:
		{
			end(data: string): void;
		};
	};
}

interface NitroEnvironmentLike<Context extends UpgradeContext>
{
	hot: HotChannelLike;
	dispatchFetch(request: Request): Promise<Response>;
	devServer?:
	{
		upgrade?: (context: Context) => Promise<void>;
	};
}

interface DevServerLike<Context extends UpgradeContext>
{
	environments:
	{
		nitro?: NitroEnvironmentLike<Context>;
		ssr?:
		{
			hot: HotChannelLike;
		};
	};
}

interface DevPlugin
{
	name: string;
	apply: "serve";
	configureServer<Context extends UpgradeContext>(server: DevServerLike<Context>): void;
}

/**
 * Call from module scope at the end of a server environment's entry: tells the dev server the entry has loaded,
 * and answers when a dev server that started listening later asks. A no-op outside dev, where there is no hot channel.
 */
export function announceDevEnvReady(hot: HotChannelLike | undefined): void
{
	if (hot === undefined) return;
	hot.send(DEV_ENV_READY_EVENT);
	hot.on(DEV_ENV_READY_QUERY, () =>
	{
		hot.send(DEV_ENV_READY_EVENT);
	});
}

/** {@link announceDevEnvReady} for whichever server environment loaded this module; each loads its own copy. */
export function announceThisDevEnvReady(): void
{
	announceDevEnvReady(import.meta.hot);
}

const UNAVAILABLE_BODY = "Dev server is starting; retry shortly.\n";
const UNAVAILABLE_HEADERS =
{
	"Content-Type": "text/plain; charset=utf-8",
	"Cache-Control": "no-store",
	"Retry-After": "1",
};

function unavailable(): Response
{
	return new Response(
		UNAVAILABLE_BODY,
		{
			status: 503,
			headers: UNAVAILABLE_HEADERS,
		},
	);
}

/** The same 503 as {@link unavailable}, written raw to an upgrade's socket, which then closes. */
function refuseUpgrade(context: UpgradeContext): void
{
	const headers = Object.entries(
		{
			...UNAVAILABLE_HEADERS,
			"Content-Length": String(Buffer.byteLength(UNAVAILABLE_BODY)),
			Connection: "close",
		},
	).map(([name, value]) => `${name}: ${value}\r\n`);
	context.node.socket.end(`HTTP/1.1 503 Service Unavailable\r\n${headers.join("")}\r\n${UNAVAILABLE_BODY}`);
}

/** Holds requests bound for nitro's worker until every server environment's entry has loaded. */
export function holdNitroRequestsUntilReady({
	timeoutMs = DEFAULT_TIMEOUT_MS,
}:
{
	timeoutMs?: number;
} = {}): DevPlugin
{
	return {
		name: "ccp:hold-nitro-requests-until-ready",
		apply: "serve",
		configureServer(server)
		{
			const nitro = server.environments.nitro;
			if (nitro === undefined) return;

			const waiting = new Set<string>();
			let opened: () => void = () =>
			{
			};
			const ready = new Promise<void>((resolve) =>
			{
				opened = resolve;
			});
			for (const name of SERVER_ENVIRONMENTS)
			{
				const hot = server.environments[name]?.hot;
				if (hot === undefined) continue;
				waiting.add(name);
				hot.on(DEV_ENV_READY_EVENT, () =>
				{
					waiting.delete(name);
					if (waiting.size === 0) opened();
				});
				hot.send(DEV_ENV_READY_QUERY);
			}

			// After one timeout, stop holding: if an announcement was missed (or the entry failed to load, which
			// nitro reports itself), waiting longer would only put every request behind the same timeout.
			let gaveUp = false;
			/** Resolves true once the gate opens (or was given up on), false when this wait times out. */
			const opens = async (): Promise<boolean> =>
			{
				if (waiting.size === 0 || gaveUp) return true;
				let timer: ReturnType<typeof setTimeout> | undefined;
				const timedOut = new Promise<false>((resolve) =>
				{
					timer = setTimeout(() =>
					{
						resolve(false);
					}, timeoutMs);
				});
				const opened = await Promise.race([ready.then(() => true), timedOut]);
				clearTimeout(timer);
				if (!opened) gaveUp = true;
				return opened;
			};

			const dispatchFetch = nitro.dispatchFetch.bind(nitro);
			nitro.dispatchFetch = async (request) => ((await opens()) ? dispatchFetch(request) : unavailable());

			// nitro looks up its runner's upgrade() on every upgrade, so replacing it here holds them too.
			const runner = nitro.devServer;
			const upgrade = runner?.upgrade;
			if (runner === undefined || upgrade === undefined) return;
			runner.upgrade = async (context) =>
			{
				if (await opens()) return upgrade(context);
				refuseUpgrade(context);
			};
		},
	};
}
