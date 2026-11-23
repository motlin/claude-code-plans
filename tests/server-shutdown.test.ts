import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	holdRequestsUntil,
	listenForTakeover,
	onServerShutdown,
	requestTakeover,
	runServerShutdownHooks,
	takeOverServerShutdown,
} from "../src/lib/server-shutdown";

afterEach(async () =>
{
	await runServerShutdownHooks();
});

describe("server shutdown hooks", () =>
{
	it("runs every registered hook once, even when one throws", async () =>
	{
		const calls: string[] = [];
		onServerShutdown(() =>
		{
			calls.push("sync");
		});
		onServerShutdown(() =>
		{
			throw new Error("boom");
		});
		onServerShutdown(async () =>
		{
			await Promise.resolve();
			calls.push("async");
		});

		await runServerShutdownHooks();
		await runServerShutdownHooks();

		expect(calls.toSorted()).toStrictEqual(["async", "sync"]);
	});

	it("shares hooks across separately bundled module instances", async () =>
	{
		const calls: string[] = [];
		const registry = Symbol.for("claude-code-browser.server-shutdown-hooks");
		onServerShutdown(() =>
		{
			calls.push("registered");
		});

		expect((globalThis as Record<symbol, unknown>)[registry]).toBeInstanceOf(Set);
		await runServerShutdownHooks();
		expect(calls).toStrictEqual(["registered"]);
	});

	it("returns an unregister function", async () =>
	{
		const calls: string[] = [];
		const unregister = onServerShutdown(() =>
		{
			calls.push("removed");
		});
		unregister();

		await runServerShutdownHooks();

		expect(calls).toStrictEqual([]);
	});

	it("takeOverServerShutdown tears down the previous instance before registering the new hook", async () =>
	{
		const calls: string[] = [];
		onServerShutdown(async () =>
		{
			await Promise.resolve();
			calls.push("previous instance");
		});

		await takeOverServerShutdown(() =>
		{
			calls.push("new instance");
		});
		const afterTakeOver = [...calls];
		await runServerShutdownHooks();

		expect(
			{
				afterTakeOver,
				afterShutdown: calls,
			},
		).toStrictEqual(
			{
				afterTakeOver: ["previous instance"],
				afterShutdown: ["previous instance", "new instance"],
			},
		);
	});

	it("takeOverServerShutdown runs the new hook and aborts its signal when shutdown begins mid-takeover", async () =>
	{
		const calls: string[] = [];

		const takeover = takeOverServerShutdown(() =>
		{
			calls.push("new instance");
		});
		await runServerShutdownHooks();
		const stopping = await takeover;

		expect(
			{
				calls,
				aborted: stopping.aborted,
			},
		).toStrictEqual(
			{
				calls: ["new instance"],
				aborted: true,
			},
		);
	});

	it("requestTakeover waits for another instance (e.g. a previous dev worker thread) to release its handles, even when this thread stalls past the ack window before reading its acknowledgement", async () =>
	{
		const events: string[] = [];
		const stop = listenForTakeover(async () =>
		{
			events.push("previous:teardown:start");
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 50);
			});
			events.push("previous:teardown:end");
		});

		const takeover = requestTakeover(
			{
				ackWindowMs: 20,
			},
		);
		// A loaded machine can starve the thread this long; the window timer is then due before the queued messages.
		const stalledUntil = performance.now() + 100;
		while (performance.now() < stalledUntil)
		{
			// Busy-wait: block the event loop.
		}
		await takeover;
		events.push("new:takeover-complete");
		stop();

		expect(events).toStrictEqual(["previous:teardown:start", "previous:teardown:end", "new:takeover-complete"]);
	});

	it("holdRequestsUntil holds a request that arrives mid-takeover until the takeover finishes, so it cannot open the databases alongside the previous instance", async () =>
	{
		const events: string[] = [];
		const stop = listenForTakeover(async () =>
		{
			events.push("previous:teardown:start");
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 50);
			});
			events.push("previous:teardown:end");
		});
		const takeover = requestTakeover(
			{
				ackWindowMs: 20,
			},
		).then(() =>
		{
			events.push("new:takeover-complete");
		});
		const fetch = holdRequestsUntil(takeover, (request: Request) =>
		{
			events.push(`handled ${new URL(request.url).pathname}`);
			return new Response("ok");
		});

		const response = await fetch(new Request("http://localhost/api/sessions"));
		stop();

		expect(
			{
				events,
				body: await response.text(),
			},
		).toStrictEqual(
			{
				events: [
					"previous:teardown:start",
					"previous:teardown:end",
					"new:takeover-complete",
					"handled /api/sessions",
				],
				body: "ok",
			},
		);
	});

	it("holdRequestsUntil lets requests through, without waiting again, once startup settles even when it failed", async () =>
	{
		const fetch = holdRequestsUntil(Promise.reject(new Error("takeover failed")), () => new Response("handled"));

		const response = await fetch(new Request("http://localhost/"));

		expect(await response.text()).toBe("handled");
	});

	it("an instance tears down only once, for the first takeover", async () =>
	{
		let teardowns = 0;
		const stop = listenForTakeover(() =>
		{
			teardowns++;
		});

		await requestTakeover(
			{
				ackWindowMs: 20,
			},
		);
		await requestTakeover(
			{
				ackWindowMs: 20,
			},
		);
		stop();

		expect(teardowns).toBe(1);
	});

	it("requestTakeover rejects, rather than letting the new instance open the databases alongside it, when a previous instance never releases", async () =>
	{
		const stop = listenForTakeover(async () => new Promise(() => {}));

		const takeover = requestTakeover(
			{
				ackWindowMs: 20,
				releaseTimeoutMs: 60,
			},
		);

		await expect(takeover).rejects.toThrow(
			"The previous server instance did not release its databases within 60ms; refusing to open them alongside it",
		);
		stop();
	});

	it("requestTakeover resolves when the ack window closes, not at the release timeout, when no other instance is running", async () =>
	{
		// Only the timers are fake: the window closes after real passes through the event loop's poll phase.
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
		const afterPollPasses = async () =>
		{
			for (let pass = 0; pass < 2; pass++)
			{
				await new Promise((resolve) =>
				{
					setImmediate(resolve);
				});
			}
		};
		try
		{
			let resolved = false;
			const takeover = requestTakeover(
				{
					ackWindowMs: 20,
					releaseTimeoutMs: 60_000,
				},
			).then(() =>
			{
				resolved = true;
			});
			await vi.advanceTimersByTimeAsync(19);
			await afterPollPasses();
			const beforeWindow = resolved;
			await vi.advanceTimersByTimeAsync(1);
			await afterPollPasses();
			const atWindow = resolved;
			await vi.advanceTimersByTimeAsync(60_000);
			await takeover;
			expect(
				{
					beforeWindow,
					atWindow,
				},
			).toStrictEqual(
				{
					beforeWindow: false,
					atWindow: true,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});
});
