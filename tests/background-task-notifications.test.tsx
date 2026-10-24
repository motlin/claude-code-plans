// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {parseTaskNotification} from "../src/lib/background-tasks";
import {summarizeToolCallStats} from "../src/lib/session-utils";
import type {Subagent} from "../src/lib/subagents";
import type {TranscriptMode} from "../src/lib/transcript-mode";
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

function renderLines(
	input: unknown[],
	transcriptMode: TranscriptMode = "normal",
	subagents: Subagent[] = [],
): HTMLElement {
	const {lines, toolResultMap} = processTranscript(input);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode={transcriptMode}
			subagents={subagents}
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
	return [...container.querySelectorAll("h2")].filter((heading) => heading.textContent.startsWith("You said")).length;
}

describe("parseTaskNotification", () => {
	it("reads the status, tool use, and the quoted description from the summary", () => {
		expect(parseTaskNotification(COMPLETED)).toStrictEqual({
			taskId: "b1x2y3",
			toolUseId: "toolu_bash",
			status: "completed",
			command: true,
			agent: false,
			description: "Run the test suite",
			durationMs: null,
		});
	});

	it("treats a killed agent as stopped and as a task, not a command", () => {
		expect(parseTaskNotification(notification("killed", 'Agent "Fetch reminders" was stopped'))).toStrictEqual({
			taskId: "b1x2y3",
			toolUseId: "toolu_bash",
			status: "stopped",
			command: false,
			agent: true,
			description: "Fetch reminders",
			durationMs: null,
		});
	});

	it("reads the run time from the usage block", () => {
		expect(
			parseTaskNotification(
				'<task-notification>\n<tool-use-id>toolu_agent</tool-use-id>\n<status>completed</status>\n<summary>Agent "Commit crank sensitivity change" finished</summary>\n<usage><subagent_tokens>65394</subagent_tokens><tool_uses>4</tool_uses><duration_ms>26738</duration_ms></usage>\n</task-notification>',
			),
		).toStrictEqual({
			taskId: null,
			toolUseId: "toolu_agent",
			status: "completed",
			command: false,
			agent: true,
			description: "Commit crank sensitivity change",
			durationMs: 26738,
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
			rawTag: container.textContent.includes("<task-notification>"),
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
			oldLabel: container.textContent.includes("Background task failed"),
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

/** A teammate that finished one slow foreground command at each `finishedAt`. */
function teammate(finishedAt: string[]): Subagent {
	return {
		id: "agent-ateammate",
		sessionId: "test-session",
		projectId: "proj",
		parentAgentId: null,
		agentType: "general-purpose",
		attributionAgent: null,
		slug: null,
		description: "Address review",
		model: null,
		startedAt: "1999-12-31T00:00:00.000Z",
		finishedAt: "1999-12-31T01:00:00.000Z",
		slowCommands: finishedAt.map((at, index) => ({
			finishedAt: at,
			description: `Run tests ${index + 1}`,
			status: "completed",
		})),
	};
}

/**
 * 6473581f: the parent ends a turn, a teammate runs slow foreground commands
 * while it idles, then a task notification opens a turn with two commands.
 */
function idleThenNotifiedRecords(): unknown[] {
	const at = (seconds: number) => new Date(Date.UTC(1999, 11, 31, 0, 0, seconds)).toISOString();
	const bash = (uuid: string, id: string, seconds: number, description: string) => [
		{
			type: "assistant",
			uuid,
			timestamp: at(seconds),
			message: {
				role: "assistant",
				content: [{type: "tool_use", id, name: "Bash", input: {command: "ls", description}}],
			},
		},
		{
			type: "user",
			uuid: `${uuid}-r`,
			timestamp: at(seconds + 1),
			message: {role: "user", content: [{type: "tool_result", tool_use_id: id, content: "ok"}]},
		},
	];
	const [prompt, launch, launchResult] = records(COMPLETED) as [unknown, unknown, unknown];
	return [
		prompt,
		launch,
		launchResult,
		{
			type: "assistant",
			uuid: "a-idle",
			timestamp: at(10),
			message: {role: "assistant", content: [{type: "text", text: "Waiting on the teammate."}]},
		},
		{
			type: "user",
			uuid: "n-1",
			timestamp: at(500),
			promptSource: "system",
			turnOrigin: "task_notification",
			message: {role: "user", content: COMPLETED},
		},
		...bash("a-2", "toolu_one", 501, "Check one"),
		...bash("a-3", "toolu_two", 503, "Check two"),
		{
			type: "assistant",
			uuid: "a-4",
			timestamp: at(510),
			message: {role: "assistant", content: [{type: "text", text: "The stack fails at commit 8."}]},
		},
		...bash("a-5", "toolu_three", 520, "Check three"),
		{
			type: "assistant",
			uuid: "a-6",
			timestamp: at(530),
			message: {role: "assistant", content: [{type: "text", text: "Done."}]},
		},
	];
}

describe("subagent-owned slow commands in the transcript", () => {
	beforeEach(() => {
		// A tall viewport, so the virtualized list mounts every row.
		vi.stubGlobal("innerHeight", 10_000);
	});

	const at = (seconds: number) => new Date(Date.UTC(1999, 11, 31, 0, 0, seconds)).toISOString();

	it("counts the teammate commands that finished while the parent idled in the run a notification opens", () => {
		const idle = [30, 60, 90, 120, 200, 300, 450].map(at);
		const container = renderLines(idleThenNotifiedRecords(), "normal", [teammate(idle)]);
		const labels = [...container.querySelectorAll("button[aria-expanded]:not([data-info-tip])")].map(
			(button) => button.textContent,
		);
		expect(labels).toStrictEqual(["Ran 2 commands, finished 8 background commands"]);
	});

	it("counts a command that finished inside a run in that run", () => {
		const container = renderLines(idleThenNotifiedRecords(), "normal", [teammate([at(521)])]);
		const labels = [...container.querySelectorAll("button[aria-expanded]:not([data-info-tip])")].map(
			(button) => button.textContent,
		);
		expect(labels).toStrictEqual([
			"Ran 2 commands, finished a background command",
			"Ran a command, finished a background command",
		]);
	});

	it("draws nothing for a command that finished while the parent talked, before a run its tool opens", () => {
		const container = renderLines(idleThenNotifiedRecords(), "normal", [teammate([at(515)])]);
		const labels = [...container.querySelectorAll("button[aria-expanded]:not([data-info-tip])")].map(
			(button) => button.textContent,
		);
		expect({labels, rows: container.querySelectorAll("[data-background-notice]").length}).toStrictEqual({
			labels: ["Ran 2 commands, finished a background command"],
			rows: 0,
		});
	});

	it("lists each absorbed command as a background-command sub-row after the calls", () => {
		const container = renderLines(idleThenNotifiedRecords(), "normal", [teammate([at(30)])]);
		fireEvent.click(summaryButton(container, "Ran 2 commands, finished 2 background commands"));
		expect(groupRowTexts(container)).toStrictEqual([
			"Checked one",
			"Checked two",
			"Background commandRun the test suite",
			"Background commandRun tests 1",
		]);
	});

	it("leaves the counts alone in Verbose", () => {
		const container = renderLines(idleThenNotifiedRecords(), "verbose", [teammate([at(30)])]);
		expect(container.textContent.includes("background commands")).toBe(false);
	});
});

/** A do-all subagent that ran a slow foreground command at each `finishedAt`. */
function doAllWorker(
	bareId: string,
	description: string,
	commands: [string, string, ("completed" | "failed")?][],
): Subagent {
	return {
		...teammate([]),
		id: `agent-${bareId}`,
		description,
		slowCommands: commands.map(([finishedAt, command, status = "completed"]) => ({
			finishedAt,
			description: command,
			status,
		})),
	};
}

/**
 * do-all 23301293:2534-2587: the parent ends its turn, the M1-41 worker runs six slow
 * commands while it idles, then hands back; the M1-42 worker's first slow command
 * finishes after the parent's last turn.
 */
function doAllIdleRecords(): unknown[] {
	const text = (uuid: string, timestamp: string, body: string) => ({
		type: "assistant",
		uuid,
		timestamp,
		message: {role: "assistant", content: [{type: "text", text: body}]},
	});
	return [
		{type: "user", uuid: "u-1", timestamp: "2026-10-18T01:00:00.000Z", message: {role: "user", content: "do all"}},
		text("a-1", "2026-10-18T01:40:28.000Z", "M1-40 is done. Nothing is pushed."),
		{
			type: "user",
			uuid: "u-handback",
			timestamp: "2026-10-18T01:57:47.547Z",
			isMeta: true,
			promptSource: "system",
			turnOrigin: "peer",
			message: {
				role: "user",
				content:
					'Another Claude session sent a message:\n<agent-message from="a3bc840d29ae2ae76">\n[Subagent hand-back] M1-41 is done.\n</agent-message>',
			},
		},
		{
			type: "assistant",
			uuid: "a-2",
			timestamp: "2026-10-18T01:57:56.000Z",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_verify",
						name: "Bash",
						input: {command: "git log", description: "Verify M1-41, gate, next task"},
					},
				],
			},
		},
		{
			type: "user",
			uuid: "u-2",
			timestamp: "2026-10-18T01:57:56.500Z",
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_verify", content: "ok"}]},
		},
		text("a-3", "2026-10-18T01:58:04.000Z", "M1-42 is running now."),
	];
}

describe("idle-period subagent slow commands", () => {
	beforeEach(() => {
		vi.stubGlobal("innerHeight", 10_000);
	});

	const workers = [
		doAllWorker("a3bc840d29ae2ae76", "Do task M1-41", [
			["2026-10-18T01:45:20.789Z", "Update story primitives and run checks"],
			["2026-10-18T01:45:32.810Z", "Fix type error and recheck"],
			["2026-10-18T01:46:08.319Z", "List warning locations and run full tests"],
			["2026-10-18T01:47:35.331Z", "Recheck and retest after CSS fix"],
			["2026-10-18T01:56:27.445Z", "Run precommit on committed HEAD"],
			["2026-10-18T01:57:31.579Z", "Rebase onto configured upstream"],
		]),
		doAllWorker("a7bf00a8bdb7bdc65", "Do task M1-42", [["2026-10-18T02:01:27.582Z", "Fix formatting and recheck"]]),
	];

	it('draws "6 background commands completed" before the hand-back and the lone trailing command after the last turn', () => {
		const container = renderLines(doAllIdleRecords(), "normal", workers);
		const text = container.textContent;
		expect({
			rows: [...container.querySelectorAll("[data-task-event-row]")].map((row) => row.textContent),
			beforeHandBack: /6 background commands completed.*Message from/s.test(text),
		}).toStrictEqual({
			rows: ["6 background commands completed", "Background command completed·Fix formatting and recheck"],
			beforeHandBack: true,
		});
	});

	it("draws no idle rows in Verbose", () => {
		const container = renderLines(doAllIdleRecords(), "verbose", workers);
		expect(container.querySelectorAll("[data-task-event-row]").length).toBe(0);
	});
});

/**
 * do-all 23301293:5652-5657: the parent ends its M2-44 turn, the M2-47 worker runs six
 * slow commands while it idles (the 2-minute timeout backgrounds one, whose notification
 * also arrives, and the last, `git fetch`, errors), then hands back.
 */
function doAllFailedIdleRecords(): unknown[] {
	return [
		{type: "user", uuid: "u-1", timestamp: "2026-10-18T10:00:00.000Z", message: {role: "user", content: "do all"}},
		{
			type: "assistant",
			uuid: "a-1",
			timestamp: "2026-10-18T10:25:30.000Z",
			message: {role: "assistant", content: [{type: "text", text: "M2-44 is done."}]},
		},
		{
			type: "user",
			uuid: "u-handback",
			timestamp: "2026-10-18T10:37:46.104Z",
			isMeta: true,
			promptSource: "system",
			turnOrigin: "peer",
			message: {
				role: "user",
				content:
					'Another Claude session sent a message:\n<agent-message from="a7da25778818cc058">\n[Subagent hand-back] M2-47 is done.\n</agent-message>',
			},
		},
		{
			type: "assistant",
			uuid: "a-2",
			timestamp: "2026-10-18T10:37:50.000Z",
			message: {role: "assistant", content: [{type: "text", text: "M2-47 is done."}]},
		},
	];
}

describe("idle-period background command failures", () => {
	beforeEach(() => {
		vi.stubGlobal("innerHeight", 10_000);
	});

	const worker = doAllWorker("a7da25778818cc058", "Do task M2-47", [
		["2026-10-18T10:26:33.369Z", "Patch editable-text and run checks"],
		["2026-10-18T10:27:08.576Z", "vp test 2>&1 | tail -5; git status --short"],
		["2026-10-18T10:29:32.968Z", 'vp test 2>&1 | grep -E "Test Files|Tests |FAIL" | head'],
		["2026-10-18T10:29:34.449Z", 'vp test 2>&1 | grep -E "Test Files|Tests |FAIL" | head'],
		["2026-10-18T10:32:24.514Z", "git test run HEAD --retest"],
		["2026-10-18T10:36:25.710Z", "git test run HEAD --retest | grep FAIL"],
		["2026-10-18T10:37:33.830Z", "git fetch -q origin && git rev-list --count HEAD..origin/main", "failed"],
	]);

	it('draws "6 background commands completed, 1 failed" with the failed part in danger ink', () => {
		const container = renderLines(doAllFailedIdleRecords(), "normal", [worker]);
		const row = container.querySelector("[data-task-event-row]");
		expect({
			text: row?.textContent,
			danger: [...(row?.querySelectorAll(".text-danger-ink") ?? [])].map((part) => part.textContent),
		}).toStrictEqual({text: "6 background commands completed, 1 failed", danger: ["1 failed"]});
	});

	it("labels a lone failed command as failed", () => {
		const lone = doAllWorker("a7da25778818cc058", "Do task M2-47", [
			["2026-10-18T10:37:33.830Z", "git fetch -q origin", "failed"],
		]);
		const container = renderLines(doAllFailedIdleRecords(), "normal", [lone]);
		expect([...container.querySelectorAll("[data-task-event-row]")].map((row) => row.textContent)).toStrictEqual([
			"Background command failed·git fetch -q origin",
		]);
	});
});

/**
 * do-all 23301293:5726-5792: the parent asks an AskUserQuestion and waits an hour and a
 * half for the answer while the flaky-test worker runs its slow commands, then runs three
 * commands. Upstream draws "16 background commands completed" right after the answer and
 * before "Ran 3 commands", the wait for an answer being an idle gap like one between turns.
 */
function doAllAnsweredQuestionRecords(): unknown[] {
	const bash = (uuid: string, timestamp: string, id: string, description: string) => ({
		type: "assistant",
		uuid,
		timestamp,
		message: {
			role: "assistant",
			content: [{type: "tool_use", id, name: "Bash", input: {command: "git status", description}}],
		},
	});
	const result = (uuid: string, timestamp: string, id: string, content: string) => ({
		type: "user",
		uuid,
		timestamp,
		message: {role: "user", content: [{type: "tool_result", tool_use_id: id, content}]},
	});
	return [
		{type: "user", uuid: "u-1", timestamp: "2026-10-18T12:50:00.000Z", message: {role: "user", content: "do all"}},
		{
			type: "assistant",
			uuid: "a-1",
			timestamp: "2026-10-18T12:57:32.000Z",
			message: {role: "assistant", content: [{type: "text", text: "The flaky-test fix is running."}]},
		},
		{
			type: "assistant",
			uuid: "a-2",
			timestamp: "2026-10-18T12:57:40.000Z",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_ask",
						name: "AskUserQuestion",
						input: {
							questions: [
								{
									question: "Push them?",
									header: "Push",
									multiSelect: false,
									options: [
										{label: "Not yet", description: "Keep them local"},
										{label: "Push now", description: "Push to origin"},
									],
								},
							],
						},
					},
				],
			},
		},
		result("u-answer", "2026-10-18T14:24:54.989Z", "toolu_ask", 'The user answered: "Push them?"="Not yet".'),
		bash("a-3", "2026-10-18T14:25:02.000Z", "toolu_b1", "Verify the flake fix"),
		result("u-3", "2026-10-18T14:26:47.000Z", "toolu_b1", "ok"),
		bash("a-4", "2026-10-18T14:26:51.000Z", "toolu_b2", "Inspect the login item"),
		result("u-4", "2026-10-18T14:30:04.000Z", "toolu_b2", "ok"),
		bash("a-5", "2026-10-18T14:30:09.000Z", "toolu_b3", "Add the login refs"),
		result("u-5", "2026-10-18T14:30:10.000Z", "toolu_b3", "ok"),
		{
			type: "assistant",
			uuid: "a-6",
			timestamp: "2026-10-18T14:30:17.000Z",
			message: {role: "assistant", content: [{type: "text", text: "Found the login item."}]},
		},
	];
}

describe("subagent slow commands while the parent waits for an answer", () => {
	beforeEach(() => {
		vi.stubGlobal("innerHeight", 10_000);
	});

	/** The sixteen slow commands upstream tracked for the worker during the wait. */
	const worker = doAllWorker(
		"af8969df565542bf7",
		"Fix flaky tests",
		[
			"12:57:59",
			"13:00:17",
			"13:01:22",
			"13:01:37",
			"13:01:53",
			"13:05:32",
			"13:09:28",
			"13:11:21",
			"13:12:11",
			"13:13:00",
			"13:15:18",
			"13:18:34",
			"13:19:45",
			"13:22:13",
			"13:26:00",
			"13:26:32",
		].map((time, index) => [`2026-10-18T${time}.000Z`, `Stress step ${index + 1}`]),
	);

	it('draws "16 background commands completed" after the answer and before the run that follows it', () => {
		const container = renderLines(doAllAnsweredQuestionRecords(), "normal", [worker]);
		const text = container.textContent;
		expect({
			rows: [...container.querySelectorAll("[data-task-event-row]")].map((row) => row.textContent),
			order: /Not yet.*16 background commands completed.*Ran 3 commands/s.test(text),
		}).toStrictEqual({rows: ["16 background commands completed"], order: true});
	});

	it("draws no idle row for the wait in Verbose", () => {
		const container = renderLines(doAllAnsweredQuestionRecords(), "verbose", [worker]);
		expect(container.querySelectorAll("[data-task-event-row]").length).toBe(0);
	});
});
