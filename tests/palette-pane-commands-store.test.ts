// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import
{
	clearPanePaletteState,
	getPanePaletteState,
	type PanePaletteState,
	publishPanePaletteState,
	usePanePaletteState,
} from "../src/lib/palette-pane-commands-store";

const HIDDEN =
{
	enabled: true,
	shown: false,
};

function state(sessionId: string): PanePaletteState
{
	return {
		sessionId,
		terminal: HIDDEN,
		changes: HIDDEN,
		files: HIDDEN,
		sideChat: HIDDEN,
		newTerminalEnabled: false,
		closePaneEnabled: false,
		paneExpanded: false,
		run: () =>
		{
		},
	};
}

afterEach(() =>
{
	cleanup();
	clearPanePaletteState(getPanePaletteState()?.sessionId ?? "");
});

describe("palette pane commands store", () =>
{
	it("clears only the session that published, so a late unmount keeps a newer page's state", () =>
	{
		const a = state("a");
		publishPanePaletteState(a);
		clearPanePaletteState("b");
		const afterOther = getPanePaletteState();
		clearPanePaletteState("a");

		expect([afterOther, getPanePaletteState()]).toStrictEqual([a, null]);
	});

	it("re-renders a subscriber on publish and clear", () =>
	{
		const {result} = renderHook(() => usePanePaletteState());
		const before = result.current;
		const a = state("a");
		act(() =>
		{
			publishPanePaletteState(a);
		});
		const published = result.current;
		act(() =>
		{
			clearPanePaletteState("a");
		});

		expect([before, published, result.current]).toStrictEqual([null, a, null]);
	});
});
