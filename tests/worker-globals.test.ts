// @vitest-environment jsdom

import {describe, expect, it, vi} from "vite-plus/test";

import {restoreWorkerGlobals} from "./worker-globals";

describe("restoreWorkerGlobals", () =>
{
	it("puts back the worker's own localStorage, sessionStorage and fetch after a file redefines them", () =>
	{
		const local = localStorage;
		const session = sessionStorage;
		const fetch = globalThis.fetch;
		Object.defineProperty(
			globalThis,
			"localStorage",
			{
				configurable: true,
				get()
				{
					throw new Error("denied");
				},
			},
		);
		Object.defineProperty(
			globalThis,
			"sessionStorage",
			{
				configurable: true,
				value: {},
			},
		);

		// A spy the file never restored would otherwise answer a later file's real requests, as a stubbed Recents feed did.
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));

		restoreWorkerGlobals();

		expect([localStorage === local, sessionStorage === session, globalThis.fetch === fetch]).toStrictEqual([
			true,
			true,
			true,
		]);
	});
});
