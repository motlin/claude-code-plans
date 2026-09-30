import {describe, expect, it} from "vite-plus/test";

import {
	backgroundTaskMeta,
	backgroundTasksFacts,
	extractBackgroundTasks,
	groupBackgroundTasks,
	type BackgroundTask,
} from "../src/lib/background-tasks";
import type {JsonValue} from "../src/lib/hook-events";

type TranscriptRecord = Record<string, JsonValue>;

const SESSION = "5e5510a0-0000-4000-8000-00000000fab1";

function toolUse(id: string, name: string, input: Record<string, JsonValue>, timestamp: string): TranscriptRecord {
	return {
		type: "assistant",
		sessionId: SESSION,
		timestamp,
		message: {role: "assistant", content: [{type: "tool_use", id, name, input}]},
	};
}

function toolResult(toolUseId: string, content: string, toolUseResult: JsonValue, timestamp: string): TranscriptRecord {
	return {
		type: "user",
		sessionId: SESSION,
		timestamp,
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: toolUseId, content, is_error: false}],
		},
		toolUseResult,
	};
}

function notification(body: string, timestamp: string): TranscriptRecord {
	return {
		type: "user",
		sessionId: SESSION,
		timestamp,
		origin: {kind: "task-notification"},
		message: {role: "user", content: `<task-notification>\n${body}\n</task-notification>`},
	};
}

/** A background build, its completion notice and a TaskOutput read of it. */
const BASH_RECORDS: TranscriptRecord[] = [
	toolUse(
		"toolu_bash_build",
		"Bash",
		{command: "pnpm build", description: "Build the fabricated app", run_in_background: true},
		"2026-09-28T10:00:00.000Z",
	),
	toolResult(
		"toolu_bash_build",
		"Command running in background with ID: bfab1build. Output is being written to: /tmp/fab/bfab1build.output.",
		{stdout: "", stderr: "", interrupted: false, backgroundTaskId: "bfab1build"},
		"2026-09-28T10:00:01.000Z",
	),
	toolUse("toolu_read_build", "TaskOutput", {task_id: "bfab1build"}, "2026-09-28T10:00:30.000Z"),
	toolResult(
		"toolu_read_build",
		"<retrieval_status>success</retrieval_status>\n\n<task_id>bfab1build</task_id>\n\n<task_type>local_bash</task_type>\n\n<status>completed</status>\n\n<exit_code>0</exit_code>\n\n<output>\nvite v8 building for production...\nbuilt in 1.2s\n</output>",
		null,
		"2026-09-28T10:00:31.000Z",
	),
	notification(
		[
			"<task-id>bfab1build</task-id>",
			"<tool-use-id>toolu_bash_build</tool-use-id>",
			"<output-file>/tmp/fab/bfab1build.output</output-file>",
			"<status>completed</status>",
			'<summary>Background command "Build the fabricated app" completed (exit code 0)</summary>',
		].join("\n"),
		"2026-09-28T10:00:32.000Z",
	),
];

/** A Monitor watch that has streamed one event and not yet ended. */
const MONITOR_RECORDS: TranscriptRecord[] = [
	toolUse(
		"toolu_monitor_ci",
		"Monitor",
		{command: "gh pr checks 42 --watch", description: "Fabricated PR #42 CI checks"},
		"2026-09-28T10:01:00.000Z",
	),
	toolResult(
		"toolu_monitor_ci",
		"Monitor started (task bfab1watch, expires in 30m unless the source ends first).",
		{taskId: "bfab1watch", timeoutMs: 1800000, persistent: false},
		"2026-09-28T10:01:01.000Z",
	),
	notification(
		[
			"<task-id>bfab1watch</task-id>",
			'<summary>Monitor event: "Fabricated PR #42 CI checks"</summary>',
			"<event>lint pass</event>",
		].join("\n"),
		"2026-09-28T10:01:30.000Z",
	),
];

/** A background agent that was launched and has not notified yet. */
const AGENT_RECORDS: TranscriptRecord[] = [
	toolUse(
		"toolu_agent_review",
		"Agent",
		{
			description: "Review the fabricated diff",
			prompt: "Review it",
			subagent_type: "general-purpose",
			run_in_background: true,
		},
		"2026-09-28T10:02:00.000Z",
	),
	toolResult(
		"toolu_agent_review",
		"Async agent launched successfully.\nagentId: afab1review (internal ID)",
		{isAsync: true, status: "async_launched", agentId: "afab1review"},
		"2026-09-28T10:02:01.000Z",
	),
];

function task(overrides: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask {
	return {
		toolUseId: null,
		kind: "bash",
		description: "",
		command: null,
		status: "running",
		output: null,
		summary: null,
		...overrides,
	};
}

const BUILD_TASK = task({
	id: "bfab1build",
	toolUseId: "toolu_bash_build",
	description: "Build the fabricated app",
	command: "pnpm build",
	status: "completed",
	output: "vite v8 building for production...\nbuilt in 1.2s",
	summary: 'Background command "Build the fabricated app" completed (exit code 0)',
});

const WATCH_TASK = task({
	id: "bfab1watch",
	toolUseId: "toolu_monitor_ci",
	kind: "monitor",
	description: "Fabricated PR #42 CI checks",
	command: "gh pr checks 42 --watch",
	output: "lint pass",
	summary: 'Monitor event: "Fabricated PR #42 CI checks"',
});

const REVIEW_TASK = task({
	id: "afab1review",
	toolUseId: "toolu_agent_review",
	kind: "agent",
	description: "Review the fabricated diff",
});

describe("extractBackgroundTasks", () => {
	it("finishes a background bash from its task-notification and keeps its TaskOutput", () => {
		expect(extractBackgroundTasks(BASH_RECORDS, {sessionActive: true})).toStrictEqual({
			running: [],
			finished: [BUILD_TASK],
		});
	});

	it("keeps a Monitor watch running and collects its events as output", () => {
		expect(extractBackgroundTasks(MONITOR_RECORDS, {sessionActive: true})).toStrictEqual({
			running: [WATCH_TASK],
			finished: [],
		});
	});

	it("lists a launched background agent as running until it notifies", () => {
		expect(
			extractBackgroundTasks([...BASH_RECORDS, ...MONITOR_RECORDS, ...AGENT_RECORDS], {
				sessionActive: true,
			}),
		).toStrictEqual({running: [WATCH_TASK, REVIEW_TASK], finished: [BUILD_TASK]});
	});

	it("finishes an agent from a failed notification with its result as output", () => {
		const failed = notification(
			[
				"<task-id>afab1review</task-id>",
				"<tool-use-id>toolu_agent_review</tool-use-id>",
				"<status>failed</status>",
				'<summary>Agent "Review the fabricated diff" failed: stalled</summary>',
				"<result>Partial review of the fabricated diff.</result>",
			].join("\n"),
			"2026-09-28T10:05:00.000Z",
		);
		expect(extractBackgroundTasks([...AGENT_RECORDS, failed], {sessionActive: true})).toStrictEqual({
			running: [],
			finished: [
				{
					...REVIEW_TASK,
					status: "failed",
					output: "Partial review of the fabricated diff.",
					summary: 'Agent "Review the fabricated diff" failed: stalled',
				},
			],
		});
	});

	it("adds running subagents and hook background tasks the transcript window lacks", () => {
		expect(
			extractBackgroundTasks(BASH_RECORDS, {
				sessionActive: true,
				runningSubagents: [
					{
						key: "toolu_agent_sync",
						sessionId: SESSION,
						agentType: "Explore",
						agentId: "",
						description: "Explore the fabricated repo",
					},
				],
				hookTasks: [
					{
						id: "bfab1serve",
						type: "local_bash",
						status: "running",
						description: "Serve the fabricated app",
						command: "pnpm dev",
					},
					{
						id: "bfab1build",
						type: "local_bash",
						status: "running",
						description: "Build the fabricated app",
						command: "pnpm build",
					},
				],
			}),
		).toStrictEqual({
			running: [
				task({
					id: "toolu_agent_sync",
					toolUseId: "toolu_agent_sync",
					kind: "agent",
					description: "Explore the fabricated repo",
				}),
				task({id: "bfab1serve", description: "Serve the fabricated app", command: "pnpm dev"}),
			],
			finished: [BUILD_TASK],
		});
	});

	it("shows transcript tasks still unfinished in an inactive session as stopped", () => {
		expect(extractBackgroundTasks([...MONITOR_RECORDS, ...AGENT_RECORDS], {sessionActive: false})).toStrictEqual({
			running: [],
			finished: [
				{...REVIEW_TASK, status: "stopped"},
				{...WATCH_TASK, status: "stopped"},
			],
		});
	});

	it("ignores foreground bash calls", () => {
		expect(
			extractBackgroundTasks(
				[
					toolUse("toolu_fg", "Bash", {command: "ls"}, "2026-09-28T10:00:00.000Z"),
					toolResult("toolu_fg", "README.md", {stdout: "README.md"}, "2026-09-28T10:00:01.000Z"),
				],
				{sessionActive: true},
			),
		).toStrictEqual({running: [], finished: []});
	});
});

describe("groupBackgroundTasks", () => {
	it("splits running from finished, newest finished first", () => {
		const first = task({id: "a", status: "completed"});
		const second = task({id: "b", status: "stopped"});
		const live = task({id: "c"});
		expect(groupBackgroundTasks([first, live, second])).toStrictEqual({
			running: [live],
			finished: [second, first],
		});
	});
});

describe("backgroundTaskMeta", () => {
	it("names the kind and status", () => {
		expect([
			backgroundTaskMeta(BUILD_TASK),
			backgroundTaskMeta(WATCH_TASK),
			backgroundTaskMeta({...REVIEW_TASK, status: "failed"}),
			backgroundTaskMeta(task({id: "x", kind: "task", status: "stopped"})),
		]).toStrictEqual(["Bash · Completed", "Monitor · Running", "Agent · Failed", "Task · Stopped"]);
	});
});

describe("backgroundTasksFacts", () => {
	it("counts the pane's rows and running tasks, with subagents keeping it available", () => {
		const groups = {running: [WATCH_TASK], finished: [BUILD_TASK]};
		expect([
			backgroundTasksFacts(groups, 0),
			backgroundTasksFacts({running: [], finished: []}, 3),
			backgroundTasksFacts({running: [], finished: []}, 0),
		]).toStrictEqual([
			{total: 2, running: 1},
			{total: 3, running: 0},
			{total: 0, running: 0},
		]);
	});
});
