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
	it("draws one notification the queue never delivered as its own row, labelled by its status", () => {
		const container = renderRecords([
			reply,
			enqueue(
				notification(
					"toolu_elsewhere2",
					"killed",
					'Background command "Wait for test-branch to finish" was stopped',
				),
			),
		]);

		expect(taskEventRows(container)).toStrictEqual(["Background task stopped·Wait for test-branch to finish"]);
	});

	it("collapses two or more undelivered notifications in one slot into upstream's single summary row", () => {
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

		expect(taskEventRows(container)).toStrictEqual(["1 background command completed, 1 stopped"]);
	});

	it("keeps one summary row when only a hidden line sits between two undelivered notifications, as upstream walks rendered items", () => {
		const container = renderRecords([
			reply,
			enqueue(
				notification("toolu_elsewhere1", "completed", 'Background command "First" completed (exit code 0)'),
			),
			{
				type: "user",
				uuid: "meta-1",
				isMeta: true,
				timestamp: "2026-10-11T14:56:16.000Z",
				message: {role: "user", content: "Caveat: hidden meta context"},
			},
			enqueue(
				notification("toolu_elsewhere2", "completed", 'Background command "Second" completed (exit code 0)'),
			),
		]);

		expect({
			rows: taskEventRows(container),
			metaShown: container.textContent.includes("hidden meta context"),
		}).toStrictEqual({rows: ["2 background commands completed"], metaShown: false});
	});

	it("places an undelivered notification after assistant text flushed later but timestamped before its enqueue", () => {
		const container = renderRecords([
			{
				type: "queue-operation",
				operation: "enqueue",
				timestamp: "2026-10-11T14:47:39.000Z",
				sessionId: "test-session",
				content: notification(
					"toolu_elsewhere1",
					"completed",
					'Background command "Run git test on every branch commit" completed (exit code 0)',
				),
			},
			reply,
		]);

		const text = container.textContent;
		const order = ["Waiting on the teammate.", "Background command completed"].toSorted(
			(first, second) => text.indexOf(first) - text.indexOf(second),
		);
		expect({rows: taskEventRows(container), order}).toStrictEqual({
			rows: ["Background command completed·Run git test on every branch commit"],
			order: ["Waiting on the teammate.", "Background command completed"],
		});
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

	it("draws a run with a failed part as upstream's wrapping summary: failed part nowrap in danger ink, label min-w-0 break-words", () => {
		const container = renderRecords([
			reply,
			enqueue(
				notification("toolu_elsewhere1", "completed", 'Background command "First" completed (exit code 0)'),
			),
			enqueue(
				notification("toolu_elsewhere2", "completed", 'Background command "Second" completed (exit code 0)'),
			),
			enqueue(notification("toolu_elsewhere3", "failed", 'Background command "Third" failed with exit code 1')),
		]);

		const row = container.querySelector("[data-task-event-row]")!;
		const label = row.querySelector("[data-turn-status-marker] > span > span")!;
		expect({
			rows: taskEventRows(container),
			label: label.className,
			parts: Array.from(label.children, (part) => ({text: part.textContent, className: part.className})),
		}).toStrictEqual({
			rows: ["2 background commands completed, 1 failed"],
			label: "text-body text-secondary group-hover/tool:text-primary min-w-0 break-words",
			parts: [
				{text: "2 background commands completed", className: ""},
				{text: ", ", className: ""},
				{text: "1 failed", className: "whitespace-nowrap text-danger-ink"},
			],
		});
	});

	it("draws a single failed command with its label in danger ink", () => {
		const container = renderRecords([
			reply,
			enqueue(notification("toolu_elsewhere1", "failed", 'Background command "Fetch" failed with exit code 1')),
		]);

		const spans = container.querySelectorAll("[data-turn-status-marker] > span > span");
		expect({
			rows: taskEventRows(container),
			spans: Array.from(spans, (span) => ({text: span.textContent, className: span.className})),
		}).toStrictEqual({
			rows: ["Background command failed·Fetch"],
			spans: [
				{text: "Background command failed", className: "text-body shrink-0 text-danger-ink"},
				{text: "·", className: "text-body text-secondary group-hover/tool:text-primary shrink-0"},
				{text: "Fetch", className: "text-body text-secondary group-hover/tool:text-primary min-w-0 truncate"},
			],
		});
	});

	it("ends a single completed command with its duration, as upstream's took span", () => {
		const container = renderRecords([
			reply,
			enqueue(
				notification(
					"toolu_elsewhere1",
					"completed",
					'Background command "Build" completed (exit code 0)',
				).replace(
					"</task-notification>",
					"<usage><duration_ms>12000</duration_ms></usage>\n</task-notification>",
				),
			),
		]);

		const took = container.querySelector("[data-turn-status-marker] > span > span:last-child")!;
		expect({rows: taskEventRows(container), took: took.className}).toStrictEqual({
			rows: ["Background command completed·Build· took 12s"],
			took: "text-body text-secondary group-hover/tool:text-primary shrink-0 whitespace-nowrap tabular-nums",
		});
	});

	it("draws a single completed agent notification whose launch is elsewhere", () => {
		const container = renderRecords([
			reply,
			enqueue(notification("toolu_elsewhere1", "completed", 'Agent "Review the diff" completed')),
		]);

		expect(taskEventRows(container)).toStrictEqual(["Background agent completed·Review the diff"]);
	});
});
