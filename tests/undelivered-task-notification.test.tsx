// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({
		settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("innerHeight", 10_000);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[]): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

const reply = {
	type: "assistant",
	uuid: "assistant-1",
	timestamp: "2026-10-11T14:47:24.000Z",
	message: {role: "assistant", content: [{type: "text", text: "Waiting on the teammate."}]},
};

function notification(toolUseId: string, status: string, summary: string): string {
	return `<task-notification>\n<task-id>b5auh1l9v</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>/tmp/tasks/b5auh1l9v.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`;
}

function enqueue(content: string): unknown {
	return {
		type: "queue-operation",
		operation: "enqueue",
		timestamp: "2026-10-11T14:56:15.767Z",
		sessionId: "test-session",
		content,
	};
}

const dequeue = {
	type: "queue-operation",
	operation: "dequeue",
	timestamp: "2026-10-11T14:56:15.770Z",
	sessionId: "test-session",
};

function taskEventRows(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll("[data-task-event-row]"), (row) => row.textContent);
}

describe("undelivered background-task notifications", () => {
	it("draws a status row for each notification the queue never delivered, labelled by its status", () => {
		const container = renderRecords([
			reply,
			enqueue(
				notification(
					"toolu_elsewhere1",
					"completed",
					'Background command "Wait for test-branch runs to finish" completed (exit code 0)',
				),
			),
			enqueue(
				notification(
					"toolu_elsewhere2",
					"killed",
					'Background command "Wait for test-branch to finish" was stopped',
				),
			),
		]);

		expect(taskEventRows(container)).toStrictEqual([
			"Background command completed · Wait for test-branch runs to finish",
			"Background task stopped · Wait for test-branch to finish",
		]);
	});

	it("draws no status row for a notification the queue delivered", () => {
		const content = notification(
			"toolu_elsewhere1",
			"completed",
			'Background command "Wait for test-branch runs to finish" completed (exit code 0)',
		);
		const container = renderRecords([
			reply,
			enqueue(content),
			dequeue,
			{type: "user", uuid: "user-2", message: {role: "user", content}},
		]);

		expect(taskEventRows(container)).toStrictEqual([]);
	});

	it("draws no status row for a notification the queue removed, or one whose launch is in this transcript", () => {
		const removed = notification(
			"toolu_elsewhere1",
			"completed",
			'Background command "Removed" completed (exit code 0)',
		);
		const container = renderRecords([
			{
				type: "assistant",
				uuid: "assistant-0",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_launched",
							name: "Bash",
							input: {command: "sleep 1", description: "Sleep", run_in_background: true},
						},
					],
				},
			},
			reply,
			enqueue(removed),
			{...(enqueue(removed) as object), operation: "remove"},
			enqueue(notification("toolu_launched", "completed", 'Background command "Sleep" completed (exit code 0)')),
		]);

		expect(taskEventRows(container)).toStrictEqual([]);
	});
});
