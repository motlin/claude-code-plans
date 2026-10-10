// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
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

/**
 * The launch settles in its own turn and the notification opens a later one,
 * where the assistant runs another command before replying.
 */
function laterRecords(notificationText: string, launchTurnTail: unknown[] = []): unknown[] {
	const [prompt, launch, launchResult] = records(notificationText) as [unknown, unknown, unknown];
	return [
		prompt,
		launch,
		launchResult,
		...launchTurnTail,
		{
			type: "assistant",
			uuid: "a-1b",
			parentUuid: "r-1",
			message: {role: "assistant", content: [{type: "text", text: "Running in the background."}]},
		},
		{
			type: "user",
			uuid: "n-1",
			parentUuid: "a-1b",
			promptSource: "system",
			turnOrigin: "task_notification",
			message: {role: "user", content: notificationText},
		},
		{
			type: "assistant",
			uuid: "a-2",
			parentUuid: "n-1",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_check",
						name: "Bash",
						input: {command: "curl localhost", description: "Check the server"},
					},
				],
			},
		},
		{
			type: "user",
			uuid: "r-2",
			parentUuid: "a-2",
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_check", content: "000"}]},
		},
		{
			type: "assistant",
			uuid: "a-3",
			parentUuid: "r-2",
			message: {role: "assistant", content: [{type: "text", text: "The server is down."}]},
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

const NOTICE_KIND = "shrink-0 text-ink-muted";
const NOTICE_DESCRIPTION = "truncate min-w-0 text-primary";

/** The text of each row in the expanded group card, in order. */
function groupRowTexts(container: HTMLElement): (string | null)[] {
	const card = container.querySelector(".card-outline");
	if (card === null) throw new Error("No expanded group card");
	return Array.from(card.children, (row) => row.textContent);
}

/** Text and class of each span in the one background notice sub-row. */
function noticeChildren(container: HTMLElement): {text: string | null; className: string}[] {
	const notice = container.querySelector("[data-background-notice]");
	if (notice === null) throw new Error("No background notice row");
	return Array.from(notice.children, (child) => ({text: child.textContent, className: child.className}));
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
			agent: false,
			description: "Run the test suite",
		});
	});

	it("treats a killed agent as stopped and as a task, not a command", () => {
		expect(parseTaskNotification(notification("killed", 'Agent "Fetch reminders" was stopped'))).toStrictEqual({
			toolUseId: "toolu_bash",
			status: "stopped",
			command: false,
			agent: true,
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
			{verb: "Used", rest: "a tool"},
			{verb: "finished", rest: "a background task (1 stopped)"},
		]);
	});

	it('leads with a failed completion: "Finished a background command (1 failed), ran a command"', () => {
		const stats = summarizeToolCallStats(
			[{name: "Bash", input: {command: "dig neighbors.motlin.com"}}],
			[{command: true, status: "failed"}],
		);

		expect({segments: stats.segments, failed: stats.failed}).toStrictEqual({
			segments: [
				{verb: "Finished", rest: "a background command (1 failed)"},
				{verb: "ran", rest: "a command"},
			],
			failed: 0,
		});
	});

	it('leads with a failed task completion: "Finished a background task (1 failed), used a tool"', () => {
		expect(
			summarizeToolCallStats([{name: "Mystery", input: {}}], [{command: false, status: "failed"}]).segments,
		).toStrictEqual([
			{verb: "Finished", rest: "a background task (1 failed)"},
			{verb: "used", rest: "a tool"},
		]);
	});

	it('fails the launch in its own group instead: "Ran 2 commands (1 failed), finished a background command"', () => {
		const stats = summarizeToolCallStats(
			[
				{id: "toolu_launch", name: "Bash", input: {command: "just dev", run_in_background: true}},
				{id: "toolu_probe", name: "Bash", input: {command: "curl localhost"}},
			],
			[{command: true, status: "failed", toolUseId: "toolu_launch"}],
		);

		expect({segments: stats.segments, failed: stats.failed}).toStrictEqual({
			segments: [
				{verb: "Ran", rest: "2 commands (1 failed)"},
				{verb: "finished", rest: "a background command"},
			],
			failed: 1,
		});
	});

	it("fails a launch whose notification arrives in a later group", () => {
		expect(
			summarizeToolCallStats(
				[
					{id: "toolu_launch", name: "Bash", input: {command: "just dev", run_in_background: true}},
					{id: "toolu_probe", name: "Bash", input: {command: "curl localhost"}},
				],
				[],
				new Set(["toolu_launch"]),
			).segments,
		).toStrictEqual([{verb: "Ran", rest: "2 commands (1 failed)"}]);
	});

	it("settles one failed completion per failed launch in the group, whichever launch the completion reports", () => {
		expect(
			summarizeToolCallStats(
				[
					{id: "toolu_scan", name: "Bash", input: {command: "scan shards"}},
					{id: "toolu_count", name: "Bash", input: {command: "wc -l shards.tsv"}},
				],
				[
					{command: true, status: "failed", toolUseId: "toolu_elsewhere"},
					{command: true, status: "failed", toolUseId: "toolu_other"},
				],
				new Set(["toolu_scan", "toolu_elsewhere", "toolu_other"]),
			).segments,
		).toStrictEqual([
			{verb: "Finished", rest: "2 background commands (1 failed)"},
			{verb: "ran", rest: "2 commands (1 failed)"},
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
		expect({
			userTurns: userTurnCount(container),
			rawTag: container.textContent?.includes("<task-notification>") ?? false,
			expanded: toggle.getAttribute("aria-expanded"),
			groupRows: groupRowTexts(container),
			notice: noticeChildren(container),
		}).toStrictEqual({
			userTurns: 1,
			rawTag: false,
			expanded: "true",
			groupRows: ["Ran the test suite", "Background commandRun the test suite"],
			notice: [
				{text: "Background command", className: NOTICE_KIND},
				{text: "Run the test suite", className: NOTICE_DESCRIPTION},
			],
		});
	});

	it('appends a secondary "Stopped" to a stopped task\'s sub-row', () => {
		const container = renderLines(
			records(notification("stopped", 'Background command "Run the test suite" was stopped')),
		);
		const toggle = summaryButton(container, "Ran a command, finished a background command (1 stopped)");
		fireEvent.click(toggle);
		expect(noticeChildren(container)).toStrictEqual([
			{text: "Background command", className: NOTICE_KIND},
			{text: "Run the test suite", className: NOTICE_DESCRIPTION},
			{text: "Stopped", className: "shrink-0 text-secondary"},
		]);
	});

	it('leads the group label and the expanded rows with a failed background command and its danger "Failed"', () => {
		const container = renderLines(
			laterRecords(notification("failed", 'Background command "Run the test suite" failed with exit code 7')),
		);
		fireEvent.click(summaryButton(container, "Finished a background command (1 failed), ran a command"));
		expect({
			groupRows: groupRowTexts(container),
			notice: noticeChildren(container),
			oldLabel: container.textContent?.includes("Background task failed") ?? false,
		}).toStrictEqual({
			groupRows: ["Background commandRun the test suiteFailed", "Checked the server"],
			notice: [
				{text: "Background command", className: NOTICE_KIND},
				{text: "Run the test suite", className: NOTICE_DESCRIPTION},
				{text: "Failed", className: "shrink-0 text-danger-ink"},
			],
			oldLabel: false,
		});
	});

	it("lists a failed notice after its own launch, as the launch takes the failure", () => {
		const container = renderLines(
			records(notification("failed", 'Background command "Run the test suite" failed with exit code 7')),
		);
		fireEvent.click(summaryButton(container, "Ran a command (1 failed), finished a background command"));
		expect(groupRowTexts(container)).toStrictEqual([
			"Run the test suiteFailed",
			"Background commandRun the test suiteFailed",
		]);
	});

	it("fails a launch in an earlier group once its later notification reports failure", () => {
		const container = renderLines(
			laterRecords(notification("failed", 'Background command "Run the test suite" failed with exit code 7'), [
				{
					type: "assistant",
					uuid: "a-1a",
					parentUuid: "r-1",
					message: {
						role: "assistant",
						content: [{type: "tool_use", id: "toolu_tail", name: "Bash", input: {command: "sleep 1"}}],
					},
				},
				{
					type: "user",
					uuid: "r-1a",
					parentUuid: "a-1a",
					message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_tail", content: ""}]},
				},
			]),
		);
		expect(summaryButton(container, "Ran 2 commands (1 failed)").textContent).toBe("Ran 2 commands (1 failed)");
	});

	it("keeps the raw notification as its own turn in Verbose", () => {
		const container = renderLines(records(COMPLETED), "verbose");
		expect(userTurnCount(container)).toBe(2);
	});
});

/** Text and class of each direct child of the launch row header inside the expanded group. */
function launchRowChildren(container: HTMLElement): {text: string | null; className: string}[] {
	const header = container.querySelector(".card-outline [data-tool-row] .group\\/tool");
	if (header === null) throw new Error("No launch row in the expanded group");
	return Array.from(header.children, (child) => ({text: child.textContent, className: child.className}));
}

describe("background launch row status", () => {
	const MUTED_PHRASE = "truncate min-w-0 text-body text-ink-muted group-hover/tool:text-secondary";
	const CHEVRON = {text: "", className: "shrink-0 -ms-1 text-ink-muted group-hover/tool:text-secondary"};
	const expandedLaunchRow = (status: string, summary: string, label: string) => {
		const container = renderLines(records(notification(status, summary)));
		fireEvent.click(summaryButton(container, label));
		return launchRowChildren(container);
	};

	it('marks a launch whose notification failed "Failed", failing the command rather than the completion in the group label', () => {
		expect(
			expandedLaunchRow(
				"failed",
				'Background command "Run the test suite" failed with exit code 7',
				"Ran a command (1 failed), finished a background command",
			),
		).toStrictEqual([
			{text: "Run the test suite", className: MUTED_PHRASE},
			{text: "Failed", className: "shrink-0 text-body text-danger-ink"},
			CHEVRON,
		]);
	});

	it('marks a killed launch "Stopped" in secondary ink', () => {
		expect(
			expandedLaunchRow(
				"killed",
				'Background command "Run the test suite" was stopped',
				"Ran a command, finished a background command (1 stopped)",
			),
		).toStrictEqual([
			{text: "Run the test suite", className: MUTED_PHRASE},
			{text: "Stopped", className: "shrink-0 text-body text-secondary"},
			CHEVRON,
		]);
	});

	it("leaves a completed launch on its past-tense label with no status", () => {
		expect(
			expandedLaunchRow(
				"completed",
				'Background command "Run the test suite" completed (exit code 0)',
				"Ran a command, finished a background command",
			),
		).toStrictEqual([{text: "Ran the test suite", className: MUTED_PHRASE}, CHEVRON]);
	});
});
