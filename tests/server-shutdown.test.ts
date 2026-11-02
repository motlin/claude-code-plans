import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import
{
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

	it("requestTakeover waits for another instance (e.g. a previous dev worker thread) to release its handles", async () =>
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

		await requestTakeover(
			{
				ackWindowMs: 20,
			},
		);
		events.push("new:takeover-complete");
		stop();

		expect(events).toStrictEqual(["previous:teardown:start", "previous:teardown:end", "new:takeover-complete"]);
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

	it("requestTakeover resolves when the ack window closes, not at the release timeout, when no other instance is running", async () =>
	{
		vi.useFakeTimers();
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
			const beforeWindow = resolved;
			await vi.advanceTimersByTimeAsync(1);
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
