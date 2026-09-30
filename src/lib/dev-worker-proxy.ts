// In dev, nitro serves the app from an env-runner worker thread listening on an ephemeral loopback port, and
// forwards every request to it with httpxy's proxyFetch over a keep-alive agent. When either event loop stalls
// (a synchronous SQLite scan, a heavy transform), a request can land on a pooled socket the worker is about to
// expire; the worker destroys it unread, the proxy fails with `read ECONNRESET`, and vite reports that as an
// "Internal server error" with no route and answers the browser with a 500.

type HeaderMap = Record<string, string | string[] | undefined>;

interface RequestLike {
	method?: string | undefined;
	url?: string | undefined;
	socket: {destroyed: boolean};
}

interface DevServerLike {
	middlewares: {use(fn: typeof closeWorkerConnection | typeof devRequestErrorHandler): unknown};
}

interface DevPlugin {
	name: string;
	apply: "serve";
	enforce?: "pre";
	configureServer(server: DevServerLike): void | (() => void);
}

const CLIENT_DISCONNECT_CODES = new Set([
	"ECONNRESET",
	"EPIPE",
	"ECONNABORTED",
	"ABORT_ERR",
	"ERR_STREAM_PREMATURE_CLOSE",
]);

/**
 * Forwarded with the request, `Connection: close` stops the proxy agent from pooling worker sockets, so there is
 * never a stale one to reuse. A fresh loopback connection costs next to nothing; a stalled worker just answers late.
 */
export function closeWorkerConnection(
	req: {headers: HeaderMap; rawHeaders: string[]},
	_res: unknown,
	next: () => void,
): void {
	req.headers["connection"] = "close";
	// srvx builds the forwarded request's headers from rawHeaders, not the parsed map.
	const index = req.rawHeaders.findIndex((name, i) => i % 2 === 0 && name.toLowerCase() === "connection");
	if (index === -1) {
		req.rawHeaders.push("Connection", "close");
	} else {
		req.rawHeaders[index + 1] = "close";
	}
	next();
}

/**
 * Drops disconnect errors for requests whose browser has already gone away, and names the route on every other
 * error before vite logs it.
 */
export function devRequestErrorHandler(
	err: unknown,
	req: RequestLike,
	res: {destroyed: boolean},
	next: (err: unknown) => void,
): void {
	const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
	const clientGone = req.socket.destroyed || res.destroyed;
	if (clientGone && code !== undefined && CLIENT_DISCONNECT_CODES.has(code)) {
		return;
	}
	if (err instanceof Error) {
		err.message = `${err.message} (${req.method ?? "GET"} ${req.url ?? ""})`;
	}
	next(err);
}

/**
 * The connection middleware must run before nitro's pre middleware, which dispatches matched routes directly;
 * the error handler must be registered after nitro's catch-all, so list these plugins after `nitro()`.
 */
export function devWorkerProxy(): [DevPlugin, DevPlugin] {
	return [
		{
			name: "ccp:dev-worker-connection-close",
			apply: "serve",
			enforce: "pre",
			configureServer(server) {
				server.middlewares.use(closeWorkerConnection);
			},
		},
		{
			name: "ccp:dev-request-errors",
			apply: "serve",
			configureServer(server) {
				return () => {
					server.middlewares.use(devRequestErrorHandler);
				};
			},
		},
	];
}
