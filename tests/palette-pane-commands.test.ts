import {describe, expect, it} from "vite-plus/test";

import {PANE_PALETTE_COMMANDS, panePaletteActions} from "../src/lib/palette-pane-commands";
import type {PanePaletteState, PaneToggleState} from "../src/lib/palette-pane-commands-store";

function toggle(enabled: boolean, shown: boolean): PaneToggleState
{
	return {
		enabled,
		shown,
	};
}

function state(overrides: Partial<PanePaletteState>): PanePaletteState
{
	return {
		sessionId: "sess-1",
		terminal: toggle(true, false),
		changes: toggle(true, false),
		files: toggle(true, false),
		sideChat: toggle(true, false),
		newTerminalEnabled: true,
		closePaneEnabled: true,
		paneExpanded: false,
		run: () =>
		{
		},
		...overrides,
	};
}

function pairs(value: PanePaletteState | null): [string, string][]
{
	return panePaletteActions(value).map(({id, label}) => [id, label]);
}

describe("palette pane commands", () =>
{
	it("keeps upstream's catalog order, search hints and shortcuts", () =>
	{
		expect(
			Object.entries(PANE_PALETTE_COMMANDS).map(([id, command]) => [
				id,
				command.searchHints,
				"shortcut" in command ? command.shortcut : undefined,
			]),
		).toStrictEqual([
			["toggle_terminal_pane", ["shell", "console"], "toggle_terminal"],
			["toggle_diff_pane", ["diff"], "toggle_changes"],
			["toggle_files_pane", ["tree", "explorer"], "toggle_files"],
			["toggle_side_chat", ["btw", "question"], "toggle_side_chat"],
			["new_terminal", ["shell", "console"], undefined],
			["close_side_pane", ["panel"], "close_pane"],
			["expand_side_pane", ["panel"], "expand_collapse_pane"],
			["collapse_side_pane", ["panel"], "expand_collapse_pane"],
		]);
	});

	it("lists nothing without a published session page", () =>
	{
		expect(pairs(null)).toStrictEqual([]);
	});

	it("offers the Show rows, New terminal, Close and Expand when nothing is shown", () =>
	{
		expect(pairs(state({}))).toStrictEqual([
			["toggle_terminal_pane", "Show terminal"],
			["toggle_diff_pane", "Show changes"],
			["toggle_files_pane", "Show files"],
			["toggle_side_chat", "Show side chat"],
			["new_terminal", "New terminal"],
			["close_side_pane", "Close pane"],
			["expand_side_pane", "Expand pane"],
		]);
	});

	it("flips to Hide and Collapse when everything is shown and a pane is expanded", () =>
	{
		expect(
			pairs(
				state(
					{
						terminal: toggle(true, true),
						changes: toggle(true, true),
						files: toggle(true, true),
						sideChat: toggle(true, true),
						paneExpanded: true,
					},
				),
			),
		).toStrictEqual([
			["toggle_terminal_pane", "Hide terminal"],
			["toggle_diff_pane", "Hide changes"],
			["toggle_files_pane", "Hide files"],
			["toggle_side_chat", "Hide side chat"],
			["new_terminal", "New terminal"],
			["close_side_pane", "Close pane"],
			["collapse_side_pane", "Collapse pane"],
		]);
	});

	it("drops the terminal rows without a terminal and the pane rows without an open pane", () =>
	{
		expect(
			pairs(
				state(
					{
						terminal: toggle(false, false),
						sideChat: toggle(false, false),
						newTerminalEnabled: false,
						closePaneEnabled: false,
					},
				),
			),
		).toStrictEqual([
			["toggle_diff_pane", "Show changes"],
			["toggle_files_pane", "Show files"],
		]);
	});
});
