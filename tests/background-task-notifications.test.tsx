// @vitest-environment jsdom

import {cleanup, fireEvent, render, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {parseTaskNotification} from "../src/lib/background-tasks";
import {summarizeToolCallStats} from "../src/lib/session-utils";
import type {TranscriptMode} from "../src/lib/transcript-mode";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
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
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function notification(status: string, summary: string): string {
	return [
		"<task-notification>",
		"<task-id>b1x2y3</task-id>",
		"<tool-use-id>toolu_bash</tool-use-id>",
		"<output-file>/private/tmp/tasks/b1x2y3.output</output-file>",
		`<status>${status}</status>`,
		`<summary>${summary}</summary>`,
		"</task-notification>",
	].join("\n");
}

const COMPLETED = notification("completed", 'Background command "Run the test suite" completed (exit code 0)');

function records(notificationText: string): unknown[] {
	return [
		{type: "user", uuid: "u-1", message: {role: "user", content: "run the tests in the background"}},
		{
			type: "assistant",
			uuid: "a-1",
			parentUuid: "u-1",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_bash",
						name: "Bash",
						input: {command: "pnpm test", description: "Run the test suite", run_in_background: true},
					},
				],
			},
		},
		{
			type: "user",
			uuid: "r-1",
			parentUuid: "a-1",
			message: {
				role: "user",
				content: [{type: "tool_result", tool_use_id: "toolu_bash", content: "Command running in background"}],
			},
		},
		{
			type: "user",
			uuid: "n-1",
			parentUuid: "r-1",
			promptSource: "system",
			turnOrigin: "task_notification",
			message: {role: "user", content: notificationText},
		},
		{
			type: "assistant",
			uuid: "a-2",
			parentUuid: "n-1",
			message: {role: "assistant", content: [{type: "text", text: "The tests passed."}]},
		},
	];
}

function renderLines(input: unknown[], transcriptMode: TranscriptMode = "normal"): HTMLElement {
	const {lines, toolResultMap} = processTranscript(input);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode={transcriptMode}
		/>,
	).container;
}

function summaryButton(container: HTMLElement, label: string): HTMLElement {
	const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
	if (button === undefined) throw new Error(`No summary button reads "${label}"`);
	return button;
}

function userTurnCount(container: HTMLElement): number {
	return [...container.querySelectorAll("h2")].filter(
		(heading) => heading.textContent?.startsWith("You said") === true,
	).length;
}

describe("parseTaskNotification", () => {
	it("reads the status, tool use, and the quoted description from the summary", () => {
		expect(parseTaskNotification(COMPLETED)).toStrictEqual({
			toolUseId: "toolu_bash",
			status: "completed",
			command: true,
			description: "Run the test suite",
		});
	});

	it("treats a killed agent as stopped and as a task, not a command", () => {
		expect(parseTaskNotification(notification("killed", 'Agent "Fetch reminders" was stopped'))).toStrictEqual({
			toolUseId: "toolu_bash",
			status: "stopped",
			command: false,
			description: "Fetch reminders",
		});
	});

	it("ignores text that does not open with a task notification", () => {
		expect(parseTaskNotification(`hello ${COMPLETED}`)).toBeNull();
	});
});

describe("summarizeToolCallStats with background completions", () => {
	it('reads "Ran a command, finished a background command"', () => {
		expect(
			summarizeToolCallStats(
				[{name: "Bash", input: {command: "pnpm test"}}],
				[{command: true, status: "completed"}],
			).segments,
		).toStrictEqual([
			{verb: "Ran", rest: "a command"},
			{verb: "finished", rest: "a background command"},
		]);
	});

	it('suffixes stopped tasks: "Used a tool, finished a background task (1 stopped)"', () => {
		expect(
			summarizeToolCallStats([{name: "Mystery", input: {}}], [{command: false, status: "stopped"}]).segments,
		).toStrictEqual([
			{verb: "Used Mystery", rest: ""},
			{verb: "finished", rest: "a background task (1 stopped)"},
		]);
	});

	it("counts several stopped commands", () => {
		expect(
			summarizeToolCallStats(
				[{name: "Bash", input: {command: "ls"}}],
				[
					{command: true, status: "stopped"},
					{command: true, status: "completed"},
					{command: true, status: "stopped"},
				],
			).segments,
		).toStrictEqual([
			{verb: "Ran", rest: "a command"},
			{verb: "finished", rest: "3 background commands (2 stopped)"},
		]);
	});
});

describe("task notifications in the transcript", () => {
	it("folds a completed notification into the tool group instead of a user turn in Normal", () => {
		const container = renderLines(records(COMPLETED));
		const toggle = summaryButton(container, "Ran a command, finished a background command");
		fireEvent.click(toggle);
		const subRow = within(container).getByText("Background task completed · Run the test suite");
		expect({
			userTurns: userTurnCount(container),
			rawTag: container.textContent?.includes("<task-notification>") ?? false,
			expanded: toggle.getAttribute("aria-expanded"),
			subRowRole: subRow.getAttribute("role"),
			subRowClass: subRow.className.includes("text-secondary"),
		}).toStrictEqual({
			userTurns: 1,
			rawTag: false,
			expanded: "true",
			subRowRole: null,
			subRowClass: true,
		});
	});

	it("names a stopped task in the sub-row", () => {
		const container = renderLines(
			records(notification("stopped", 'Background command "Run the test suite" was stopped')),
		);
		const toggle = summaryButton(container, "Ran a command, finished a background command (1 stopped)");
		fireEvent.click(toggle);
		expect(within(container).queryByText("Background task stopped · Run the test suite")).not.toBeNull();
	});

	it("keeps the raw notification as its own turn in Verbose", () => {
		const container = renderLines(records(COMPLETED), "verbose");
		expect(userTurnCount(container)).toBe(2);
	});
});
