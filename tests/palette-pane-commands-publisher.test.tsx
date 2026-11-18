// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {PalettePaneCommandsPublisher} from "../src/components/panes/palette-pane-commands-publisher";
import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {getPanePaletteState} from "../src/lib/palette-pane-commands-store";
import {getSideChat, resetSideChatStore} from "../src/lib/side-chat-store";
import {installLocalStorage} from "./fake-storage";

/** The published state without its handler, for strict comparison. */
function published(): unknown
{
	const state = getPanePaletteState();
	if (state === null) return null;
	const {run: _run, ...rest} = state;
	return rest;
}

function run(command: Parameters<NonNullable<ReturnType<typeof getPanePaletteState>>["run"]>[0]): void
{
	act(() =>
	{
		getPanePaletteState()?.run(command);
	});
}

function openPaneKinds(): string[]
{
	return [...document.querySelectorAll<HTMLElement>("[data-pane-root]")].map(
		(pane) => pane.dataset["paneKind"] ?? "",
	);
}

const unregisters: (() => void)[] = [];

beforeEach(() =>
{
	installLocalStorage();
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect(
			{
				x: 0,
				y: 0,
				width: 1200,
				height: 800,
			},
		),
	);
	for (const kind of ["terminal", "changes", "files"] as const)
	{
		unregisters.push(
			registerPane(
				kind,
				{
					title: kind,
					render: () => <p>{kind} body</p>,
				},
			),
		);
	}
});

afterEach(() =>
{
	for (const unregister of unregisters.splice(0)) unregister();
	cleanup();
	resetSideChatStore();
	vi.restoreAllMocks();
});

function renderPublisher()
{
	return render(
		<TileHost sessionId="sess-1">
			<PalettePaneCommandsPublisher sessionId="sess-1" terminalAvailable shells />
		</TileHost>,
	);
}

describe("PalettePaneCommandsPublisher", () =>
{
	it("publishes the session page's pane state, republishes on change and clears on unmount", () =>
	{
		const {unmount} = renderPublisher();
		const closed = published();
		run("toggle_terminal_pane");
		const terminalOpen = published();
		run("toggle_side_chat");
		const sideChatOpen = getSideChat("sess-1").open;
		unmount();

		const hidden =
		{
			enabled: true,
			shown: false,
		};
		expect(
			{
				closed,
				terminalOpen,
				sideChatOpen,
				cleared: published(),
			},
		).toStrictEqual(
			{
				closed:
				{
					sessionId: "sess-1",
					terminal: hidden,
					changes: hidden,
					files: hidden,
					sideChat: hidden,
					newTerminalEnabled: true,
					closePaneEnabled: false,
					paneExpanded: false,
				},
				terminalOpen:
				{
					sessionId: "sess-1",
					terminal:
					{
						enabled: true,
						shown: true,
					},
					changes: hidden,
					files: hidden,
					sideChat: hidden,
					newTerminalEnabled: true,
					closePaneEnabled: true,
					paneExpanded: false,
				},
				sideChatOpen: true,
				cleared: null,
			},
		);
	});

	it("opens Changes, expands and collapses it, then closes it", () =>
	{
		renderPublisher();
		run("toggle_diff_pane");
		const opened = openPaneKinds();
		run("expand_side_pane");
		const expanded = getPanePaletteState()?.paneExpanded;
		run("collapse_side_pane");
		const collapsed = getPanePaletteState()?.paneExpanded;
		run("close_side_pane");

		expect(
			{
				opened,
				expanded,
				collapsed,
				closed: openPaneKinds(),
			},
		).toStrictEqual(
			{
				opened: ["changes"],
				expanded: true,
				collapsed: false,
				closed: [],
			},
		);
	});
});
