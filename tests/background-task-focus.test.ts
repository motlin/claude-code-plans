// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {
	type BackgroundTaskFocus,
	finishedExpanded,
	onBackgroundTaskFocusRequest,
	openTaskRows,
	requestBackgroundTaskFocus,
	setFinishedExpanded,
	setTaskRowsOpen,
	takePendingBackgroundTaskFocus,
	useFinishedExpanded,
	useOpenTaskRows,
} from "../src/lib/background-task-focus";

afterEach(() => {
	cleanup();
});

describe("background task focus requests", () => {
	it("returns a request made with no listener once, then null", () => {
		requestBackgroundTaskFocus("session-pending", {taskId: "b1", finished: true});

		expect(takePendingBackgroundTaskFocus("session-pending")).toStrictEqual({taskId: "b1", finished: true});
		expect(takePendingBackgroundTaskFocus("session-pending")).toBeNull();
	});

	it("delivers a request to a mounted listener instead of leaving it pending", () => {
		const listener = vi.fn<(focus: BackgroundTaskFocus) => void>();
		const unsubscribe = onBackgroundTaskFocusRequest("session-listener", listener);

		requestBackgroundTaskFocus("session-listener", {taskId: "b1", finished: true});

		expect(listener.mock.calls).toStrictEqual([[{taskId: "b1", finished: true}]]);
		expect(takePendingBackgroundTaskFocus("session-listener")).toBeNull();

		unsubscribe();
		requestBackgroundTaskFocus("session-listener", {finished: false});

		expect(listener.mock.calls).toStrictEqual([[{taskId: "b1", finished: true}]]);
		expect(takePendingBackgroundTaskFocus("session-listener")).toStrictEqual({finished: false});
	});
});

describe("background task view state", () => {
	it("records open task rows per session", () => {
		setTaskRowsOpen("session-rows", ["a", "b"], true);

		expect(openTaskRows("session-rows")).toStrictEqual(
			new Map([
				["a", true],
				["b", true],
			]),
		);
		expect(openTaskRows("session-rows-other")).toStrictEqual(new Map());

		setTaskRowsOpen("session-rows", ["a"], false);

		expect(openTaskRows("session-rows")).toStrictEqual(
			new Map([
				["a", false],
				["b", true],
			]),
		);
	});

	it("reads back the Finished section's expanded state", () => {
		expect(finishedExpanded("session-finished")).toBeUndefined();

		setFinishedExpanded("session-finished", true);

		expect(finishedExpanded("session-finished")).toBe(true);
		expect(finishedExpanded("session-finished-other")).toBeUndefined();
	});

	it("re-renders hooks when the session's view state changes", () => {
		const {result} = renderHook(() => ({
			finished: useFinishedExpanded("session-hooks"),
			rows: useOpenTaskRows("session-hooks"),
		}));

		expect(result.current).toStrictEqual({finished: undefined, rows: new Map()});

		act(() => {
			setFinishedExpanded("session-hooks", false);
			setTaskRowsOpen("session-hooks", ["b1"], true);
		});

		expect(result.current).toStrictEqual({finished: false, rows: new Map([["b1", true]])});
	});
});
