// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";
import type {TranscriptMode} from "../src/lib/transcript-mode";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize()}));
vi.mock("../src/hooks/use-claude-events", () => ({useClaudeEvents: () => ({failedTools: new Map()})}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const PLAN_FILE = "/fabricated/plans/fabricated-plan.md";
const REJECTED =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

const prompt = {type: "user", uuid: "u-prompt", message: {role: "user", content: "Fabricated request"}};

interface Call {
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	rejected?: boolean;
}

function call({id, name, input, result, isError, rejected}: Call): unknown[] {
	const assistant = {
		type: "assistant",
		uuid: `a-${id}`,
		message: {id: `msg-${id}`, role: "assistant", content: [{type: "tool_use", id, name, input}]},
	};
	if (result === undefined) return [assistant];
	return [
		assistant,
		{
			type: "user",
			uuid: `r-${id}`,
			...(rejected === true ? {toolDenialKind: "user-rejected", toolUseResult: "User rejected tool use"} : {}),
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						content: result,
						...(isError === true ? {is_error: true} : {}),
					},
				],
			},
		},
	];
}

const bash = (id: string): Call => ({
	id,
	name: "Bash",
	input: {command: "echo fabricated", description: `Fabricated ${id}`},
	result: "ok",
});
const exitPlan = (id: string, result?: string): Call => ({
	id,
	name: "ExitPlanMode",
	input: {plan: "# Fabricated plan\n\nDo the fabricated thing."},
	...(result === undefined ? {} : {result, isError: true, rejected: true}),
});

function rows(records: unknown[], mode: TranscriptMode = "normal") {
	const {lines, toolResultMap} = processTranscript(records);
	const {container} = render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			transcriptMode={mode}
			showTools
			shouldScrollToEnd={false}
		/>,
	);
	const observed = Array.from(container.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")).map(
		(row) => ({
			perfRow: row.dataset["perfRow"],
			tools: Array.from(
				row.querySelectorAll('[data-tool-row] > [role="button"], [data-tool-row] > button'),
				(element) => element.textContent,
			),
		}),
	);
	cleanup();
	return observed;
}

const human = {perfRow: "human", tools: []};
const tool = (labels: string[]) => ({perfRow: "assistant_tool", tools: labels});

function bothModes(records: unknown[]) {
	return {normal: rows(records), verbose: rows(records, "verbose")};
}

describe("standalone calls end a tool run", () => {
	it("draws ExitPlanMode after an Edit as its own row (Hello2 last turn)", () => {
		const records = [
			prompt,
			...call({
				id: "edit",
				name: "Edit",
				input: {file_path: PLAN_FILE, old_string: "old", new_string: "new"},
				result: "The file has been updated.",
			}),
			...call(exitPlan("plan", REJECTED)),
		];
		const observed = bothModes(records);
		const expected = [
			human,
			tool(["Editedfabricated-plan.md+1−11 added, 1 removed"]),
			tool(["Proposed planStopped"]),
		];
		expect(observed).toStrictEqual({normal: expected, verbose: expected});
		expect(JSON.stringify(observed).toLowerCase()).not.toContain("proposed a plan");
	});

	it("splits a non-file tool from the ExitPlanMode after it", () => {
		const records = [
			prompt,
			...call({id: "search", name: "ToolSearch", input: {query: "select:Fabricated"}, result: "loaded"}),
			...call(exitPlan("plan", REJECTED)),
		];
		const expected = [human, tool(["Loaded tools"]), tool(["Proposed planStopped"])];
		expect(bothModes(records)).toStrictEqual({normal: expected, verbose: expected});
	});

	it("cuts Bash, Workflow, Bash into three rows", () => {
		const records = [
			prompt,
			...call(bash("one")),
			...call({id: "flow", name: "Workflow", input: {script: "fabricated"}, result: "done"}),
			...call(bash("two")),
		];
		const expected = [human, tool(["Fabricated one"]), tool(["Ran workflow"]), tool(["Fabricated two"])];
		expect(bothModes(records)).toStrictEqual({normal: expected, verbose: expected});
	});

	it("never joins two standalones", () => {
		const records = [prompt, ...call(exitPlan("first", REJECTED)), ...call(exitPlan("second", REJECTED))];
		const expected = [human, tool(["Proposed planStopped"]), tool(["Proposed planStopped"])];
		expect(bothModes(records)).toStrictEqual({normal: expected, verbose: expected});
	});

	it("rolls an Artifact read_db up with its neighbours", () => {
		const records = [
			prompt,
			...call({id: "read", name: "Read", input: {file_path: "/fabricated/a.ts"}, result: "1\tconst a = 1;"}),
			...call({
				id: "db",
				name: "Artifact",
				input: {action: "read_db", url: "https://claude.ai/artifact/x"},
				result: "[]",
			}),
		];
		expect(bothModes(records)).toStrictEqual({
			normal: [human, tool(["Read a.ts, used a tool"])],
			verbose: [human, tool(["Read a.ts, used a tool", "Read a.ts", "Used artifact tool read_db"])],
		});
	});

	it("splits an unsent PushNotification but rolls up a sent one", () => {
		const push = (result: string): Call => ({
			id: "push",
			name: "PushNotification",
			input: {message: "Fabricated done"},
			result,
		});
		const unsent = [
			prompt,
			...call(bash("one")),
			...call(push("Terminal notification sent. Mobile push not sent (Remote Control inactive).")),
		];
		const sent = [
			prompt,
			...call(bash("one")),
			...call(push("Terminal notification sent. Mobile push requested.")),
		];
		expect({unsent: bothModes(unsent), sent: bothModes(sent)}).toStrictEqual({
			unsent: {
				normal: [human, tool(["Fabricated one"]), tool(["Sent notification"])],
				verbose: [human, tool(["Fabricated one"]), tool(["Sent notification"])],
			},
			sent: {
				normal: [human, tool(["Ran a command, used a tool"])],
				verbose: [human, tool(["Ran a command, used a tool", "Fabricated one", "Sent notification"])],
			},
		});
	});

	it("keeps a pending ExitPlanMode out of the Edit run before it", () => {
		const records = [
			prompt,
			...call({
				id: "edit",
				name: "Edit",
				input: {file_path: PLAN_FILE, old_string: "old", new_string: "new"},
				result: "The file has been updated.",
			}),
			...call(exitPlan("plan")),
		];
		const expected = [
			human,
			tool(["Editedfabricated-plan.md+1−11 added, 1 removed"]),
			tool(["Proposing planProposing planrunning"]),
		];
		expect(bothModes(records)).toStrictEqual({normal: expected, verbose: expected});
	});
});

describe("notices next to a standalone", () => {
	const taskNotice = {
		type: "user",
		uuid: "n-task",
		promptSource: "system",
		turnOrigin: "task_notification",
		message: {
			role: "user",
			content: [
				"<task-notification>",
				"<task-id>fab123</task-id>",
				"<tool-use-id>one</tool-use-id>",
				"<output-file>/fabricated/tasks/fab123.output</output-file>",
				"<status>completed</status>",
				'<summary>Background command "Fabricated one" completed (exit code 0)</summary>',
				"</task-notification>",
			].join("\n"),
		},
	};

	it("attaches a task notification before a standalone to the default run before it", () => {
		const records = [prompt, ...call(bash("one")), taskNotice, ...call(exitPlan("plan", REJECTED))];
		expect(rows(records)).toStrictEqual([
			human,
			tool(["Ran a command, finished a background command"]),
			tool(["Proposed planStopped"]),
		]);
	});

	it("attaches a task notification before a standalone to the next default run when none precedes it", () => {
		const records = [
			prompt,
			...call(exitPlan("first", REJECTED)),
			taskNotice,
			...call(exitPlan("second", REJECTED)),
			...call(bash("two")),
		];
		expect(rows(records)).toStrictEqual([
			human,
			tool(["Proposed planStopped"]),
			tool(["Proposed planStopped"]),
			tool(["Ran a command, finished a background command"]),
		]);
	});
	it("reaches past a standalone to the latest default run before the notification", () => {
		const records = [
			prompt,
			...call(bash("one")),
			...call(exitPlan("first", REJECTED)),
			taskNotice,
			...call(exitPlan("second", REJECTED)),
		];
		expect(rows(records)).toStrictEqual([
			human,
			tool(["Ran a command, finished a background command"]),
			tool(["Proposed planStopped"]),
			tool(["Proposed planStopped"]),
		]);
	});

	it("keeps a task notification as its own row when the span has no default run", () => {
		const records = [prompt, taskNotice, ...call(exitPlan("plan", REJECTED))];
		expect(rows(records)).toStrictEqual([human, tool([]), tool(["Proposed planStopped"])]);
	});
});
