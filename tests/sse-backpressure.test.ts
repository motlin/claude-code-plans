import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	SSE_STALL_DROP_MS,
	addClient,
	broadcastTyped,
	removeClient,
	sseClientCount,
	stopSseStatsLog,
} from "../src/lib/sse-broadcast";

interface FakeClient
{
	controller: ReadableStreamDefaultController;
	enqueued: number;
	errors: unknown[];
	setDesiredSize: (size: number) => void;
}

const added: ReadableStreamDefaultController[] = [];

function fakeClient(initialDesiredSize: number): FakeClient
{
	let desiredSize = initialDesiredSize;
	const client: FakeClient =
	{
		controller:
		{
			enqueue: () =>
			{
				client.enqueued++;
			},
			error: (reason: unknown) =>
			{
				client.errors.push(reason);
			},
			get desiredSize()
			{
				return desiredSize;
			},
		} as unknown as ReadableStreamDefaultController,
		enqueued: 0,
		errors: [],
		setDesiredSize: (size) =>
		{
			desiredSize = size;
		},
	};
	added.push(client.controller);
	addClient(client.controller);
	return client;
}

afterEach(() =>
{
	for (const controller of added.splice(0)) removeClient(controller);
	stopSseStatsLog();
	vi.useRealTimers();
});

describe("SSE backpressure", () =>
{
	it("drops a client whose queue stays full for the stall window", () =>
	{
		vi.useFakeTimers();
		const before = sseClientCount();
		const healthy = fakeClient(1024);
		const stalled = fakeClient(-1);

		broadcastTyped(
			"x",
			{
				n: 1,
			},
		);
		vi.advanceTimersByTime(SSE_STALL_DROP_MS - 1);
		broadcastTyped(
			"x",
			{
				n: 2,
			},
		);
		const beforeWindow =
		{
			clients: sseClientCount() - before,
			errors: stalled.errors.length,
		};

		vi.advanceTimersByTime(1);
		broadcastTyped(
			"x",
			{
				n: 3,
			},
		);
		broadcastTyped(
			"x",
			{
				n: 4,
			},
		);

		expect(
			{
				beforeWindow,
				afterWindow:
				{
					clients: sseClientCount() - before,
					errors: stalled.errors.length,
				},
				stalledEnqueued: stalled.enqueued,
				healthyEnqueued: healthy.enqueued,
				healthyErrors: healthy.errors.length,
			},
		).toStrictEqual(
			{
				beforeWindow:
				{
					clients: 2,
					errors: 0,
				},
				afterWindow:
				{
					clients: 1,
					errors: 1,
				},
				stalledEnqueued: 2,
				healthyEnqueued: 4,
				healthyErrors: 0,
			},
		);
	});

	it("keeps a client that drains before the stall window ends", () =>
	{
		vi.useFakeTimers();
		const before = sseClientCount();
		const slow = fakeClient(0);

		broadcastTyped(
			"x",
			{
				n: 1,
			},
		);
		vi.advanceTimersByTime(SSE_STALL_DROP_MS - 1);
		slow.setDesiredSize(10);
		broadcastTyped(
			"x",
			{
				n: 2,
			},
		);
		slow.setDesiredSize(0);
		vi.advanceTimersByTime(SSE_STALL_DROP_MS - 1);
		broadcastTyped(
			"x",
			{
				n: 3,
			},
		);

		expect(
			{
				clients: sseClientCount() - before,
				errors: slow.errors.length,
				enqueued: slow.enqueued,
			},
		).toStrictEqual(
			{
				clients: 1,
				errors: 0,
				enqueued: 3,
			},
		);
	});

	it("tolerates a stall window of at least a minute", () =>
	{
		expect(SSE_STALL_DROP_MS >= 60_000).toBe(true);
	});
});
