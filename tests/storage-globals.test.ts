// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";

import {restoreStorageGlobals} from "./storage-globals";

describe("restoreStorageGlobals", () =>
{
	it("puts back the worker's own localStorage and sessionStorage after a file redefines them", () =>
	{
		const local = localStorage;
		const session = sessionStorage;
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

		restoreStorageGlobals();

		expect([localStorage === local, sessionStorage === session]).toStrictEqual([true, true]);
	});
});
