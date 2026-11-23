import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {createServer, request, type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Hooks} from "crossws";
import wsAdapter from "crossws/adapters/node";
import {H3} from "nitro/h3";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vite-plus/test";
import {expectRequestHold, holdRequestsUntil} from "../src/lib/server-shutdown";
import shellSocket from "../server/routes/api/shell/[ptyKey]";
import controlSocket from "../server/routes/api/herdr/control";
import observeSocket from "../server/routes/api/herdr/observe";

/**
 * Drives the real route modules through crossws's Node adapter the way the prod Nitro node-server preset does:
 * `resolveWebsocketHooks` takes the route's fetch response and uses its `crossws` hooks, so a route's `upgrade` that
 * throws a Response must end the handshake with that Response instead of a 101.
 */
const app = new H3()
	.all("/api/shell/:ptyKey", shellSocket)
	.all("/api/herdr/control", controlSocket)
	.all("/api/herdr/observe", observeSocket);

const SHELL_PATH = "/api/shell/00000000-0000-4000-8000-000000000000";
const CONTROL_PATH = "/api/herdr/control?sessionId=s&columns=80&rows=24";
const OBSERVE_PATH = "/api/herdr/observe?sessionId=s&columns=80&rows=24";

let server: Server;
let port: number;
let configHome: string;
const previousConfigHome = process.env["XDG_CONFIG_HOME"];
/** Called with each upgrade's path as the route's `upgrade` hook starts, before it first awaits. */
let onUpgradeStarted = (_pathname: string): void =>
{
};

beforeAll(async () =>
{
	configHome = await mkdtemp(join(tmpdir(), "ws-upgrade-refusal-"));
	process.env["XDG_CONFIG_HOME"] = configHome;
	const {handleUpgrade} = wsAdapter(
		{
			resolve: async (req) =>
			{
				const response: Response &
				{
					crossws?: Partial<Hooks>;
				} = await app.fetch(req);
				const upgrade = response.crossws?.upgrade;
				// Only the upgrade hook decides the handshake. The routes' open hooks probe the machine's real tmux and
				// herdr servers and open the app database after the 101 is sent, which only leaks slow background work
				// into the later tests of this shared worker.
				return upgrade === undefined
					? {}
					:
						{
							upgrade: async (request) =>
							{
								const result = upgrade(request);
								onUpgradeStarted(new URL(request.url).pathname);
								return result;
							},
						};
			},
		},
	);
	server = createServer((_req, res) =>
	{
		res.writeHead(404).end();
	});
	server.on("upgrade", (req, socket, head) =>
	{
		void handleUpgrade(req, socket, head);
	});
	await new Promise<void>((resolve) =>
	{
		server.listen(0, "127.0.0.1", resolve);
	});
	port = (server.address() as AddressInfo).port;
});

afterAll(async () =>
{
	server.closeAllConnections();
	await new Promise((resolve) =>
	{
		server.close(resolve);
	});
	if (previousConfigHome === undefined) delete process.env["XDG_CONFIG_HOME"];
	else process.env["XDG_CONFIG_HOME"] = previousConfigHome;
	await rm(
		configHome,
		{
			recursive: true,
			force: true,
		},
	);
});

async function writeConfig(config: {herdr_writes_enabled: boolean; shell_pane_enabled: boolean}): Promise<void>
{
	await mkdir(
		join(configHome, "claude-code-plans"),
		{
			recursive: true,
		},
	);
	await writeFile(join(configHome, "claude-code-plans", "config.json"), JSON.stringify(config));
}

/** Opens a raw WebSocket handshake and reports the status line and body the server answered with. */
async function handshake(
	path: string,
	headers: Record<string, string>,
): Promise<
{
	body: string;
	status: number;
}>
{
	return new Promise((resolve, reject) =>
	{
		const req = request(
			{
				host: "127.0.0.1",
				port,
				path,
				headers:
				{
					Connection: "Upgrade",
					Upgrade: "websocket",
					"Sec-WebSocket-Version": "13",
					"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
					...headers,
				},
			},
		);
		req.on("upgrade", (res, socket) =>
		{
			socket.destroy();
			resolve(
				{
					body: "",
					status: res.statusCode ?? 0,
				},
			);
		});
		req.on("response", (res) =>
		{
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk: string) =>
			{
				body += chunk;
			});
			res.on("end", () =>
			{
				resolve(
					{
						body,
						status: res.statusCode ?? 0,
					},
				);
			});
		});
		req.on("error", reject);
		req.end();
	});
}

const SAME_ORIGIN =
{
	Host: "localhost:7526",
	Origin: "http://localhost:7526",
};
const PROXIED =
{
	Host: "plans.m4.notlin.com",
	"X-Forwarded-Host": "plans.m4.notlin.com",
	"X-Forwarded-Proto": "https",
	Origin: "https://plans.m4.notlin.com",
};
const CROSS_SITE =
{
	Host: "localhost:7526",
	Origin: "https://evil.example",
};
const FORBIDDEN =
{
	body: JSON.stringify(
		{
			error: "Forbidden",
		},
	),
	status: 403,
};
const SWITCHED =
{
	body: "",
	status: 101,
};

describe("per-route WebSocket upgrade checks under the crossws node adapter", () =>
{
	describe("with herdr writes and shell tabs enabled", () =>
	{
		beforeEach(async () =>
		{
			await writeConfig(
				{
					herdr_writes_enabled: true,
					shell_pane_enabled: true,
				},
			);
		});

		it("refuses a cross-site Origin or Sec-Fetch-Site upgrade on every socket route", async () =>
		{
			const results = await Promise.all([
				handshake(SHELL_PATH, CROSS_SITE),
				handshake(CONTROL_PATH, CROSS_SITE),
				handshake(OBSERVE_PATH, CROSS_SITE),
				handshake(
					SHELL_PATH,
					{
						...SAME_ORIGIN,
						"Sec-Fetch-Site": "cross-site",
					},
				),
				handshake(
					CONTROL_PATH,
					{
						...SAME_ORIGIN,
						"Sec-Fetch-Site": "cross-site",
					},
				),
				handshake(
					OBSERVE_PATH,
					{
						...SAME_ORIGIN,
						"Sec-Fetch-Site": "cross-site",
					},
				),
			]);
			expect(results).toStrictEqual([FORBIDDEN, FORBIDDEN, FORBIDDEN, FORBIDDEN, FORBIDDEN, FORBIDDEN]);
		});

		it("upgrades the app's own same-origin sockets, directly and through the Caddy proxy", async () =>
		{
			const results = await Promise.all([
				handshake(SHELL_PATH, SAME_ORIGIN),
				handshake(CONTROL_PATH, SAME_ORIGIN),
				handshake(OBSERVE_PATH, SAME_ORIGIN),
				handshake(SHELL_PATH, PROXIED),
				handshake(CONTROL_PATH, PROXIED),
				handshake(OBSERVE_PATH, PROXIED),
			]);
			expect(results).toStrictEqual([SWITCHED, SWITCHED, SWITCHED, SWITCHED, SWITCHED, SWITCHED]);
		});
		it("holds every socket's upgrade that arrives before the SSR entry sets the takeover hold, then upgrades it once the databases open", async () =>
		{
			const events: string[] = [];
			const paths = [SHELL_PATH, CONTROL_PATH, OBSERVE_PATH];
			// Each route's upgrade hook awaits the hold as its first step, so once all three have started they are parked on it.
			const started = new Set<string>();
			const allStarted = new Promise<void>((resolve) =>
			{
				onUpgradeStarted = (pathname) =>
				{
					started.add(pathname);
					if (started.size === paths.length) resolve();
				};
			});
			// server/plugins/request-hold.ts runs this when the worker starts, before it serves any upgrade.
			expectRequestHold();
			const upgraded = Promise.all(
				paths.map(async (path) =>
				{
					const result = await handshake(path, SAME_ORIGIN);
					events.push(`${String(result.status)} ${new URL(path, "http://localhost").pathname}`);
				}),
			);

			await allStarted;
			onUpgradeStarted = () =>
			{
			};
			events.push("hold set");
			let openDatabases = (): void =>
			{
			};
			holdRequestsUntil(
				new Promise<void>((resolve) =>
				{
					openDatabases = resolve;
				}),
				() => new Response("unused"),
			);
			// Give a leaky hold time to let the parked upgrades through before the databases open; a slow machine only
			// stretches the window, it cannot reorder the events.
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 50);
			});
			events.push("databases opened");
			openDatabases();

			await upgraded;

			expect(events.slice(0, 2)).toStrictEqual(["hold set", "databases opened"]);
			expect(events.slice(2).toSorted()).toStrictEqual([
				"101 /api/herdr/control",
				"101 /api/herdr/observe",
				"101 /api/shell/00000000-0000-4000-8000-000000000000",
			]);
		});
	});

	describe("with herdr writes and shell tabs disabled", () =>
	{
		beforeEach(async () =>
		{
			await writeConfig(
				{
					herdr_writes_enabled: false,
					shell_pane_enabled: false,
				},
			);
		});

		it("refuses same-origin shell and control upgrades and still upgrades the read-only observer", async () =>
		{
			const results = await Promise.all([
				handshake(SHELL_PATH, SAME_ORIGIN),
				handshake(CONTROL_PATH, SAME_ORIGIN),
				handshake(OBSERVE_PATH, SAME_ORIGIN),
			]);
			expect(results).toStrictEqual([
				{
					body: JSON.stringify(
						{
							error: "Shell tabs are disabled",
						},
					),
					status: 403,
				},
				{
					body: JSON.stringify(
						{
							error: "herdr writes are disabled",
						},
					),
					status: 403,
				},
				SWITCHED,
			]);
		});
	});
});
