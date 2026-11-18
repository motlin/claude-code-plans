// @vitest-environment jsdom

import {createElement} from "react";
import {renderToString} from "react-dom/server";
import {beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	PALETTE_MODE_STORAGE_KEY,
	getPaletteModeSnapshot,
	setRememberedPaletteMode,
	subscribePaletteMode,
	usePaletteMode,
} from "../src/lib/palette-mode-store";
import {installLocalStorage} from "./fake-storage";

function Probe()
{
	return createElement("span", null, usePaletteMode());
}

describe("palette mode store", () =>
{
	beforeEach(() =>
	{
		installLocalStorage();
	});

	it("follows a tab switch or a clear made in another tab, ignoring other keys", () =>
	{
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribePaletteMode(listener);

		localStorage.setItem("cmdk-mode", "compose");
		window.dispatchEvent(
			new StorageEvent(
				"storage",
				{
					key: "cmdk-mode",
					newValue: "compose",
				},
			),
		);
		const afterSwitch = [listener.mock.calls.length, getPaletteModeSnapshot()];

		window.dispatchEvent(
			new StorageEvent(
				"storage",
				{
					key: "ccp-pins",
					newValue: "[]",
				},
			),
		);
		const afterOtherKey = listener.mock.calls.length;

		localStorage.clear();
		window.dispatchEvent(
			new StorageEvent(
				"storage",
				{
					key: null,
				},
			),
		);
		const afterClear = [listener.mock.calls.length, getPaletteModeSnapshot()];
		unsubscribe();

		expect(
			{
				afterSwitch,
				afterOtherKey,
				afterClear,
			},
		).toStrictEqual(
			{
				afterSwitch: [1, "compose"],
				afterOtherKey: 1,
				afterClear: [2, "search"],
			},
		);
	});

	it("always writes the bare tab, re-picks included, and notifies this tab", () =>
	{
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribePaletteMode(listener);
		const setItem = vi.spyOn(localStorage, "setItem");

		setRememberedPaletteMode("compose");
		setRememberedPaletteMode("compose");
		setRememberedPaletteMode("search");
		unsubscribe();

		expect(
			{
				key: PALETTE_MODE_STORAGE_KEY,
				writes: setItem.mock.calls,
				notified: listener.mock.calls.length,
				snapshot: getPaletteModeSnapshot(),
			},
		).toStrictEqual(
			{
				key: "cmdk-mode",
				writes: [
					["cmdk-mode", "compose"],
					["cmdk-mode", "compose"],
					["cmdk-mode", "search"],
				],
				notified: 3,
				snapshot: "search",
			},
		);
	});

	it("reads Search when storage throws, then keeps a switch in memory for this visit", () =>
	{
		Object.defineProperty(
			globalThis,
			"localStorage",
			{
				configurable: true,
				get: () =>
				{
					throw new Error("denied");
				},
			},
		);

		const before = getPaletteModeSnapshot();
		setRememberedPaletteMode("compose");

		expect([before, getPaletteModeSnapshot()]).toStrictEqual(["search", "compose"]);
	});

	it("renders Search on the server whatever is stored", () =>
	{
		localStorage.setItem("cmdk-mode", "compose");

		expect(renderToString(createElement(Probe))).toBe("<span>search</span>");
	});
});
