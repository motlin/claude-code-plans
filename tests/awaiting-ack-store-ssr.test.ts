// @vitest-environment node

import {afterEach, describe, expect, it, vi} from "vite-plus/test";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() =>
{
	if (original === undefined) Reflect.deleteProperty(globalThis, "localStorage");
	else Object.defineProperty(globalThis, "localStorage", original);
	vi.resetModules();
});

describe("awaiting-ack store on the server", () =>
{
	it("never touches Node's global localStorage getter", async () =>
	{
		const accesses: string[] = [];
		Object.defineProperty(
			globalThis,
			"localStorage",
			{
				configurable: true,
				get()
				{
					accesses.push("localStorage");
					throw new Error("localStorage is not available on the server");
				},
			},
		);
		vi.resetModules();
		const store = await import("../src/lib/awaiting-ack-store");
		store.ack("s1", 1000);
		const acked = store.isAcked("s1", new Date(500).toISOString());
		store.clear("s1");
		expect(
			{
				accesses,
				acked,
				after: store.ackedAt("s1"),
				hasWindow: typeof window,
			},
		).toStrictEqual(
			{
				accesses: [],
				acked: true,
				after: undefined,
				hasWindow: "undefined",
			},
		);
	});
});
