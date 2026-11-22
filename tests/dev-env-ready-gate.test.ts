import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	DEV_ENV_READY_EVENT,
	DEV_ENV_READY_QUERY,
	announceDevEnvReady,
	holdNitroRequestsUntilReady,
} from "../src/lib/dev-env-ready-gate";

class FakeHotChannel
{
	readonly sent: string[] = [];
	readonly listeners = new Map<string, Array<() => void>>();

	send(event: string): void
	{
		this.sent.push(event);
	}

	on(event: string, listener: () => void): void
	{
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
	}

	emit(event: string): void
	{
		for (const listener of this.listeners.get(event) ?? []) listener();
	}
}

class FakeSocket
{
	written: string[] = [];
	ended = false;

	end(data: string): void
	{
		this.written.push(data);
		this.ended = true;
	}
}

function upgradeContext(url: string)
{
	return {
		node:
		{
			req:
			{
				url,
			},
			socket: new FakeSocket(),
			head: Buffer.alloc(0),
		},
	};
}

function fakeServer()
{
	const dispatched: string[] = [];
	const upgraded: string[] = [];
	const nitroHot = new FakeHotChannel();
	const ssrHot = new FakeHotChannel();
	const nitro =
	{
		hot: nitroHot,
		dispatchFetch: async (request: Request) =>
		{
			dispatched.push(new URL(request.url).pathname);
			return Promise.resolve(new Response("ok"));
		},
		devServer:
		{
			upgrade: async (context: ReturnType<typeof upgradeContext>) =>
			{
				upgraded.push(context.node.req.url);
				return Promise.resolve();
			},
		},
	};
	const server =
	{
		environments:
		{
			nitro,
			ssr:
			{
				hot: ssrHot,
			},
		},
	};
	return {
		server,
		nitro,
		nitroHot,
		ssrHot,
		dispatched,
		upgraded,
	};
}

describe("holdNitroRequestsUntilReady", () =>
{
	beforeEach(() =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
	});

	afterEach(() =>
	{
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("holds a request that arrives while the server environments are still loading until both announce themselves", async () =>
	{
		const {server, nitro, nitroHot, ssrHot, dispatched, upgraded} = fakeServer();
		holdNitroRequestsUntilReady().configureServer(server);

		// A WebSocket upgrade bypasses dispatchFetch; nitro's worker drops one that arrives before its entry loads.
		const response = nitro.dispatchFetch(new Request("http://localhost/api/events"));
		const upgrade = nitro.devServer.upgrade(upgradeContext("/api/herdr/observe"));
		await vi.advanceTimersByTimeAsync(1000);
		nitroHot.emit(DEV_ENV_READY_EVENT);
		await vi.advanceTimersByTimeAsync(1000);
		expect([dispatched, upgraded]).toStrictEqual([[], []]);

		ssrHot.emit(DEV_ENV_READY_EVENT);
		const {status} = await response;
		await upgrade;

		expect(
			{
				status,
				dispatched,
				upgraded,
			},
		).toStrictEqual(
			{
				status: 200,
				dispatched: ["/api/events"],
				upgraded: ["/api/herdr/observe"],
			},
		);
	});

	it("answers 503 with Retry-After, and logs nothing, when the environments stay unavailable past the timeout", async () =>
	{
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const {server, nitro, dispatched, upgraded} = fakeServer();
		holdNitroRequestsUntilReady(
			{
				timeoutMs: 5000,
			},
		).configureServer(server);

		let answered = false;
		const pending = nitro.dispatchFetch(new Request("http://localhost/api/count"));
		void pending.then(() =>
		{
			answered = true;
		});
		const context = upgradeContext("/api/shell/key");
		const upgrade = nitro.devServer.upgrade(context);
		await vi.advanceTimersByTimeAsync(4999);
		expect([answered, context.node.socket.ended]).toStrictEqual([false, false]);
		await vi.advanceTimersByTimeAsync(1);
		const response = await pending;
		await upgrade;

		const body = "Dev server is starting; retry shortly.\n";
		expect(
			{
				status: response.status,
				retryAfter: response.headers.get("retry-after"),
				cacheControl: response.headers.get("cache-control"),
				dispatched,
				upgraded,
				refusal: context.node.socket.written,
				ended: context.node.socket.ended,
				logged: [...error.mock.calls, ...warn.mock.calls],
			},
		).toStrictEqual(
			{
				status: 503,
				retryAfter: "1",
				cacheControl: "no-store",
				dispatched: [],
				upgraded: [],
				refusal: [
					"HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nRetry-After: 1\r\n" +
						`Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
				],
				ended: true,
				logged: [],
			},
		);
	});

	it("stops holding requests once one has timed out, so a missed announcement cannot wedge the dev server", async () =>
	{
		const {server, nitro, dispatched} = fakeServer();
		holdNitroRequestsUntilReady(
			{
				timeoutMs: 5000,
			},
		).configureServer(server);

		const first = nitro.dispatchFetch(new Request("http://localhost/api/count"));
		const second = nitro.dispatchFetch(new Request("http://localhost/api/events"));
		await vi.advanceTimersByTimeAsync(5000);
		const statuses = [(await first).status, (await second).status];
		const later = await nitro.dispatchFetch(new Request("http://localhost/"));

		expect(
			{
				statuses,
				later: later.status,
				dispatched,
			},
		).toStrictEqual(
			{
				statuses: [503, 503],
				later: 200,
				dispatched: ["/"],
			},
		);
	});

	it("asks each environment whether it is ready, so one that loaded before the plugin listened still opens the gate", async () =>
	{
		const {server, nitro, nitroHot, ssrHot, dispatched} = fakeServer();
		holdNitroRequestsUntilReady().configureServer(server);

		expect([nitroHot.sent, ssrHot.sent]).toStrictEqual([[DEV_ENV_READY_QUERY], [DEV_ENV_READY_QUERY]]);
		nitroHot.emit(DEV_ENV_READY_EVENT);
		ssrHot.emit(DEV_ENV_READY_EVENT);
		await nitro.dispatchFetch(new Request("http://localhost/"));

		expect(dispatched).toStrictEqual(["/"]);
	});

	it("only waits for the server environments the dev server has", async () =>
	{
		const dispatched: string[] = [];
		const hot = new FakeHotChannel();
		const nitro =
		{
			hot,
			dispatchFetch: async (request: Request) =>
			{
				dispatched.push(new URL(request.url).pathname);
				return Promise.resolve(new Response("ok"));
			},
		};
		holdNitroRequestsUntilReady().configureServer(
			{
				environments:
				{
					nitro,
				},
			},
		);

		hot.emit(DEV_ENV_READY_EVENT);
		await nitro.dispatchFetch(new Request("http://localhost/api/count"));

		expect(dispatched).toStrictEqual(["/api/count"]);
	});

	it("does nothing for a server without a nitro environment", () =>
	{
		expect(() =>
		{
			holdNitroRequestsUntilReady().configureServer(
				{
					environments: {},
				},
			);
		}).not.toThrow();
	});
});

describe("announceDevEnvReady", () =>
{
	it("announces the environment once its entry has loaded, and again whenever the dev server asks", () =>
	{
		const hot = new FakeHotChannel();
		announceDevEnvReady(hot);
		hot.emit(DEV_ENV_READY_QUERY);

		expect(hot.sent).toStrictEqual([DEV_ENV_READY_EVENT, DEV_ENV_READY_EVENT]);
	});

	it("does nothing outside the dev server, where there is no hot channel", () =>
	{
		expect(() =>
		{
			announceDevEnvReady(undefined);
		}).not.toThrow();
	});
});
