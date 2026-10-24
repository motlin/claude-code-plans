// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {type BackgroundTasksOpener, useBackgroundTasksOpener} from "../src/components/background-tasks-opener-context";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import {SessionBackgroundTasksOpener} from "../src/components/subagent-opener";
import {finishedExpanded, takePendingBackgroundTaskFocus} from "../src/lib/background-task-focus";
import type {PaneKind} from "../src/lib/pane-layout";
import {takePendingSubagentFocus} from "../src/lib/subagent-focus-requests";

afterEach(() => {
	cleanup();
});

function hosted(host: PaneHostApi, node: ReactNode) {
	return <PaneHostContext.Provider value={host}>{node}</PaneHostContext.Provider>;
}

function renderOpener(sessionId: string): {opener: BackgroundTasksOpener; openPane: ReturnType<typeof vi.fn>} {
	const openPane = vi.fn<(kind: PaneKind) => void>();
	const host: PaneHostApi = {
		layout: {} as PaneHostApi["layout"],
		openKinds: [],
		isOpen: () => false,
		openPane,
		closePane: () => {},
		togglePane: () => {},
	};
	const captured: {opener?: BackgroundTasksOpener | null} = {};
	function Capture() {
		captured.opener = useBackgroundTasksOpener();
		return null;
	}
	render(
		hosted(
			host,
			<SessionBackgroundTasksOpener sessionId={sessionId} running={new Set()}>
				<Capture />
			</SessionBackgroundTasksOpener>,
		),
	);
	const {opener} = captured;
	if (opener === undefined || opener === null) throw new Error("no opener");
	return {opener, openPane};
}

describe("SessionBackgroundTasksOpener", () => {
	it("opens the pane at a finished task, expanding Finished and leaving a pending focus", () => {
		const {opener, openPane} = renderOpener("s-task");
		opener.open({taskId: "b1", finished: true});
		expect({
			calls: openPane.mock.calls,
			finished: finishedExpanded("s-task"),
			pending: takePendingBackgroundTaskFocus("s-task"),
			subagent: takePendingSubagentFocus("s-task"),
		}).toStrictEqual({
			calls: [["background-tasks"]],
			finished: true,
			pending: {taskId: "b1", finished: true},
			subagent: null,
		});
	});

	it("opens an agent task in the subagents pane", () => {
		const {opener, openPane} = renderOpener("s-agent");
		opener.open({agentId: "a1"});
		expect({
			calls: openPane.mock.calls,
			finished: finishedExpanded("s-agent"),
			pending: takePendingBackgroundTaskFocus("s-agent"),
			subagent: takePendingSubagentFocus("s-agent"),
		}).toStrictEqual({
			calls: [["subagents"]],
			finished: undefined,
			pending: null,
			subagent: "a1",
		});
	});

	it("expands Finished with no task on open({finished:true})", () => {
		const {opener, openPane} = renderOpener("s-finished");
		opener.open({finished: true});
		expect({
			calls: openPane.mock.calls,
			finished: finishedExpanded("s-finished"),
			pending: takePendingBackgroundTaskFocus("s-finished"),
		}).toStrictEqual({
			calls: [["background-tasks"]],
			finished: true,
			pending: null,
		});
	});

	it("does a plain open with no focus", () => {
		const {opener, openPane} = renderOpener("s-plain");
		opener.open();
		expect({
			calls: openPane.mock.calls,
			finished: finishedExpanded("s-plain"),
			pending: takePendingBackgroundTaskFocus("s-plain"),
			subagent: takePendingSubagentFocus("s-plain"),
		}).toStrictEqual({
			calls: [["background-tasks"]],
			finished: undefined,
			pending: null,
			subagent: null,
		});
	});
});
