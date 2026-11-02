import {describe, expect, it} from "vite-plus/test";
import type {HerdrTerminalPaneData, HerdrTerminalWorkspaceData} from "../src/lib/api/herdr-terminals";
import
{
	closeNeedsConfirmation,
	findTerminalPane,
	paneAfterClose,
	siblingPaneId,
} from "../src/lib/herdr/terminal-tab-nav";

function pane(paneId: string, process: HerdrTerminalPaneData["process"] = "idle"): HerdrTerminalPaneData
{
	return {
		paneId,
		terminalId: `term-${paneId}`,
		title: paneId,
		cwd: "/tmp/test",
		focused: false,
		agent: null,
		agentStatus: "unknown",
		claudeSessionId: null,
		command: "-zsh",
		process,
	};
}

const workspaces: HerdrTerminalWorkspaceData[] = [
	{
		workspaceId: "w1",
		number: 1,
		label: "test",
		focused: true,
		tabs: [
			{
				tabId: "w1:t1",
				number: 1,
				label: "one",
				focused: true,
				panes: [pane("w1:p1")],
			},
			{
				tabId: "w1:t2",
				number: 2,
				label: "three",
				focused: false,
				panes: [pane("w1:p2"), pane("w1:p3", "running"), pane("w1:p4")],
			},
		],
	},
];

describe("herdr terminal tab navigation", () =>
{
	it("finds a pane's tab and position, or nothing for an unknown pane", () =>
	{
		const found = findTerminalPane(workspaces, "w1:p3");
		expect(
			{
				found:
					found === null
						? null
						:
							{
								tab: found.tab.tabId,
								pane: found.pane.paneId,
								index: found.index,
							},
				missing: findTerminalPane(workspaces, "w1:p9"),
				unloaded: findTerminalPane(undefined, "w1:p3"),
			},
		).toStrictEqual(
			{
				found:
				{
					tab: "w1:t2",
					pane: "w1:p3",
					index: 1,
				},
				missing: null,
				unloaded: null,
			},
		);
	});

	it("steps to the next or previous pane in the tab, wrapping, and stays put in a one-pane tab", () =>
	{
		const [one, three] = workspaces[0]?.tabs ?? [];
		if (one === undefined || three === undefined) throw new Error("fixture");
		expect(
			{
				next: siblingPaneId(three, "w1:p3", 1),
				wrapNext: siblingPaneId(three, "w1:p4", 1),
				previous: siblingPaneId(three, "w1:p3", -1),
				wrapPrevious: siblingPaneId(three, "w1:p2", -1),
				alone: siblingPaneId(one, "w1:p1", 1),
			},
		).toStrictEqual(
			{
				next: "w1:p4",
				wrapNext: "w1:p2",
				previous: "w1:p2",
				wrapPrevious: "w1:p4",
				alone: null,
			},
		);
	});

	it("lands on the next pane after a close, the previous one when closing the last, and nowhere when none is left", () =>
	{
		const [one, three] = workspaces[0]?.tabs ?? [];
		if (one === undefined || three === undefined) throw new Error("fixture");
		expect(
			{
				middle: paneAfterClose(three, "w1:p3"),
				last: paneAfterClose(three, "w1:p4"),
				only: paneAfterClose(one, "w1:p1"),
			},
		).toStrictEqual(
			{
				middle: "w1:p4",
				last: "w1:p3",
				only: null,
			},
		);
	});

	it("asks before closing only while a pane's process is still running", () =>
	{
		expect(
			{
				idle: closeNeedsConfirmation([pane("a"), pane("b", "exited"), pane("c", "unknown")]),
				running: closeNeedsConfirmation([pane("a"), pane("b", "running")]),
			},
		).toStrictEqual(
			{
				idle: false,
				running: true,
			},
		);
	});
});
