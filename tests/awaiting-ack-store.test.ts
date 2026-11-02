// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	__awaitingAckTesting,
	ack,
	ackedAt,
	AWAITING_ACK_STORAGE_KEY,
	AwaitingAckStorageSchema,
	clear,
	isAcked,
	subscribeAwaitingAck,
} from "../src/lib/awaiting-ack-store";

beforeEach(() =>
{
	localStorage.clear();
	__awaitingAckTesting.reset();
});

afterEach(() =>
{
	vi.restoreAllMocks();
});

describe("awaiting-ack store", () =>
{
	it("records an ack and notifies once for a repeated value", () =>
	{
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribeAwaitingAck(listener);
		ack("s1", 1000);
		ack("s1", 1000);
		unsubscribe();
		expect(
			{
				ackedAt: ackedAt("s1"),
				notified: listener.mock.calls.length,
			},
		).toStrictEqual(
			{
				ackedAt: 1000,
				notified: 1,
			},
		);
	});

	it("clears an entry and notifies", () =>
	{
		ack("s1", 1000);
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribeAwaitingAck(listener);
		clear("s1");
		unsubscribe();
		expect(
			{
				ackedAt: ackedAt("s1"),
				notified: listener.mock.calls.length,
			},
		).toStrictEqual(
			{
				ackedAt: undefined,
				notified: 1,
			},
		);
	});

	it("is acked when the ack is at or after the mtime, like upstream's hh", () =>
	{
		ack("s1", 1000);
		expect(
			{
				equal: isAcked("s1", "1970-01-01T00:00:01.000Z"),
				later: isAcked("s1", "1970-01-01T00:00:01.001Z"),
				other: isAcked("s2", "1970-01-01T00:00:00.000Z"),
			},
		).toStrictEqual(
			{
				equal: true,
				later: false,
				other: false,
			},
		);
	});

	it("persists upstream's zustand shape under epitaxy-awaiting-ack-v1", () =>
	{
		ack("s1", 1000);
		const raw = localStorage.getItem("epitaxy-awaiting-ack-v1");
		expect(
			{
				key: AWAITING_ACK_STORAGE_KEY,
				raw,
				strict: AwaitingAckStorageSchema.strict().safeParse(JSON.parse(raw ?? "null")).success,
			},
		).toStrictEqual(
			{
				key: "epitaxy-awaiting-ack-v1",
				raw: JSON.stringify(
					{
						state:
						{
							ackedAt:
							{
								s1: 1000,
							},
						},
						version: 0,
					},
				),
				strict: true,
			},
		);
	});

	it("reads the stored acks back on a fresh module load", async () =>
	{
		localStorage.setItem(
			AWAITING_ACK_STORAGE_KEY,
			JSON.stringify(
				{
					state:
					{
						ackedAt:
						{
							s1: 1000,
						},
					},
					version: 0,
				},
			),
		);
		vi.resetModules();
		const fresh = await import("../src/lib/awaiting-ack-store");
		expect(fresh.ackedAt("s1")).toBe(1000);
	});

	it("loads malformed JSON as empty", async () =>
	{
		localStorage.setItem(AWAITING_ACK_STORAGE_KEY, "{not json");
		vi.resetModules();
		const fresh = await import("../src/lib/awaiting-ack-store");
		expect(fresh.ackedAt("s1")).toBe(undefined);
	});

	it("keeps working in memory when localStorage throws", async () =>
	{
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});
		vi.resetModules();
		const fresh = await import("../src/lib/awaiting-ack-store");
		fresh.ack("s1", 1000);
		expect(fresh.ackedAt("s1")).toBe(1000);
	});
});
