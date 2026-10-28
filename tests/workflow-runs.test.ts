import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {SessionWorkflowRunsResponse} from "../src/lib/api/session-workflow-runs";
import {
	WorkflowAgentMetaSchema,
	WorkflowJournalEventSchema,
	WorkflowRunFileSchema,
	readWorkflowRuns,
	workflowSessionIdForPath,
	type WorkflowRun,
} from "../src/lib/workflow-runs";

const SESSION = "1ff9ad30-4e13-4af4-8d20-31a37088f09f";
const RUN = "wf_b3195248-105";

let projectsDir: string;
let projectDir: string;
let sessionDir: string;
let transcriptPath: string;

beforeEach(() => {
	projectsDir = mkdtempSync(join(tmpdir(), "workflow-runs-"));
	projectDir = join(projectsDir, "-Users-alice-projects-outline");
	sessionDir = join(projectDir, SESSION);
	transcriptPath = join(projectDir, `${SESSION}.jsonl`);
	mkdirSync(sessionDir, {recursive: true});
});

afterEach(() => {
	rmSync(projectsDir, {recursive: true, force: true});
});

function writeTranscript(records: readonly unknown[]): void {
	writeFileSync(transcriptPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function launch(toolUseId: string, taskId: string, timestamp: string, runId = RUN): Record<string, unknown> {
	return {
		type: "user",
		timestamp,
		message: {
			role: "user",
			content: [
				{tool_use_id: toolUseId, type: "tool_result", content: [{type: "text", text: "Workflow launched"}]},
			],
		},
		toolUseResult: {
			status: "async_launched",
			taskId,
			taskType: "local_workflow",
			workflowName: "outline-upstream-sync",
			runId,
			summary: "Feature-by-feature parity investigation",
			transcriptDir: join(sessionDir, "subagents", "workflows", runId),
			scriptPath: join(sessionDir, "workflows", "scripts", `outline-upstream-sync-${runId}.js`),
		},
	};
}

function notificationText(taskId: string, toolUseId: string, status: string, summary: string): string {
	return [
		"<task-notification>",
		`<task-id>${taskId}</task-id>`,
		`<tool-use-id>${toolUseId}</tool-use-id>`,
		`<output-file>/private/tmp/tasks/${taskId}.output</output-file>`,
		`<status>${status}</status>`,
		`<summary>${summary}</summary>`,
		"<usage><duration_ms>4210</duration_ms></usage>",
		"</task-notification>",
	].join("\n");
}

function queuedNotification(text: string): Record<string, unknown> {
	return {type: "queue-operation", operation: "enqueue", timestamp: "2026-10-01T12:10:00.000Z", content: text};
}

function userNotification(text: string): Record<string, unknown> {
	return {type: "user", timestamp: "2026-10-01T12:10:01.000Z", message: {role: "user", content: text}};
}

function writeRunFile(run: Record<string, unknown>): void {
	mkdirSync(join(sessionDir, "workflows"), {recursive: true});
	writeFileSync(join(sessionDir, "workflows", `${RUN}.json`), JSON.stringify(run));
}

const transcriptDir = (): string => join(sessionDir, "subagents", "workflows", RUN);

function writeJournal(events: readonly unknown[]): void {
	mkdirSync(transcriptDir(), {recursive: true});
	writeFileSync(
		join(transcriptDir(), "journal.jsonl"),
		events.map((event) => JSON.stringify(event)).join("\n") + "\n",
	);
}

function writeAgent(
	agentId: string,
	meta: Record<string, unknown>,
	startedAtMs: number,
	lastProgressAtMs: number,
): void {
	const metaPath = join(transcriptDir(), `agent-${agentId}.meta.json`);
	const jsonlPath = join(transcriptDir(), `agent-${agentId}.jsonl`);
	writeFileSync(metaPath, JSON.stringify(meta));
	writeFileSync(jsonlPath, "{}\n");
	utimesSync(metaPath, startedAtMs / 1000, startedAtMs / 1000);
	utimesSync(jsonlPath, lastProgressAtMs / 1000, lastProgressAtMs / 1000);
}

const launchFields = () => ({
	runId: RUN,
	workflowName: "outline-upstream-sync",
	scriptPath: join(sessionDir, "workflows", "scripts", `outline-upstream-sync-${RUN}.js`),
	transcriptDir: transcriptDir(),
	description: "Feature-by-feature parity investigation",
});

describe("readWorkflowRuns", () => {
	it("reads a completed run's progress, duration and tokens from workflows/<runId>.json", () => {
		writeTranscript([
			launch("toolu_A", "wxkmbdj52", "2026-10-01T12:00:00.000Z"),
			userNotification(
				notificationText(
					"wxkmbdj52",
					"toolu_A",
					"completed",
					'Dynamic workflow "Feature-by-feature parity investigation" completed',
				),
			),
		]);
		writeRunFile({
			runId: RUN,
			timestamp: "2026-10-01T12:10:00.000Z",
			taskId: "wxkmbdj52",
			script: "export const meta = {name: 'outline-upstream-sync'}",
			scriptPath: join(sessionDir, "workflows", "scripts", `outline-upstream-sync-${RUN}.js`),
			result: {investigated: 2},
			agentCount: 1,
			logs: ["started"],
			durationMs: 600_000,
			summary: "Feature-by-feature parity investigation",
			workflowName: "outline-upstream-sync",
			status: "completed",
			startTime: 1_790_971_610_323,
			phases: [{title: "Broad", detail: "inventory"}],
			defaultModel: "claude-opus-5-5",
			workflowProgress: [
				{type: "workflow_phase", index: 1, title: "Broad"},
				{
					type: "workflow_agent",
					index: 1,
					label: "local-inventory",
					phaseIndex: 1,
					phaseTitle: "Broad",
					agentId: "ae56daa7cd7cf957b",
					model: "claude-opus-5-5",
					state: "done",
					startedAt: 1_790_971_610_335,
					lastProgressAt: 1_790_971_610_335,
					tokens: 1200,
					durationMs: 5000,
				},
			],
			totalTokens: 198_800,
			totalToolCalls: 12,
		});

		expect(readWorkflowRuns(transcriptPath)).toStrictEqual<WorkflowRun[]>([
			{
				...launchFields(),
				taskId: "wxkmbdj52",
				toolUseId: "toolu_A",
				toolUseIds: ["toolu_A"],
				status: "completed",
				summary: 'Dynamic workflow "Feature-by-feature parity investigation" completed',
				startedAt: 1_790_971_610_323,
				durationMs: 600_000,
				totalTokens: 198_800,
				progress: [
					{type: "workflow_phase", index: 1, title: "Broad"},
					{
						type: "workflow_agent",
						index: 1,
						label: "local-inventory",
						phaseIndex: 1,
						phaseTitle: "Broad",
						agentId: "ae56daa7cd7cf957b",
						model: "claude-opus-5-5",
						state: "done",
						startedAt: 1_790_971_610_335,
						lastProgressAt: 1_790_971_610_335,
						tokens: 1200,
						durationMs: 5000,
					},
				],
			},
		]);
	});

	it("synthesizes a running run's progress from its journal and agent files", () => {
		writeTranscript([launch("toolu_A", "wxkmbdj52", "2026-10-01T12:00:00.000Z")]);
		writeJournal([
			{type: "launched"},
			{type: "started", key: "v2:aa", agentId: "a1", label: "ours:sidebar", phase: "Inventory"},
			{type: "started", key: "v2:bb", agentId: "a2"},
			{type: "result", key: "v2:aa", agentId: "a1", result: {file: "/tmp/sidebar.json", count: 3}},
		]);
		writeAgent(
			"a1",
			{
				agentType: "workflow-subagent",
				description: "ours:sidebar",
				workflowPhase: "Inventory",
				spawnDepth: 1,
				requestShape: "foreground",
				requestNonInteractive: false,
				model: "claude-opus-5-5",
			},
			1_790_000_000_000,
			1_790_000_060_000,
		);
		writeAgent(
			"a2",
			{
				agentType: "workflow-subagent",
				description: "upstream:sidebar",
				workflowPhase: "Diff",
				spawnDepth: 1,
				requestShape: "foreground",
				requestNonInteractive: false,
			},
			1_790_000_001_000,
			1_790_000_090_000,
		);

		expect(readWorkflowRuns(transcriptPath)).toStrictEqual<WorkflowRun[]>([
			{
				...launchFields(),
				taskId: "wxkmbdj52",
				toolUseId: "toolu_A",
				toolUseIds: ["toolu_A"],
				status: "running",
				summary: null,
				startedAt: Date.parse("2026-10-01T12:00:00.000Z"),
				durationMs: null,
				totalTokens: null,
				progress: [
					{type: "workflow_phase", index: 1, title: "Inventory"},
					{type: "workflow_phase", index: 2, title: "Diff"},
					{
						type: "workflow_agent",
						index: 1,
						label: "ours:sidebar",
						agentId: "a1",
						state: "done",
						phaseIndex: 1,
						phaseTitle: "Inventory",
						model: "claude-opus-5-5",
						startedAt: 1_790_000_000_000,
						lastProgressAt: 1_790_000_060_000,
					},
					{
						type: "workflow_agent",
						index: 2,
						label: "upstream:sidebar",
						agentId: "a2",
						state: "progress",
						phaseIndex: 2,
						phaseTitle: "Diff",
						startedAt: 1_790_000_001_000,
						lastProgressAt: 1_790_000_090_000,
					},
				],
			},
		]);
	});

	it("carries a journal result's toolsUsed onto a running run's agent entry", () => {
		writeTranscript([launch("toolu_A", "wxkmbdj52", "2026-10-01T12:00:00.000Z")]);
		writeJournal([
			{type: "launched"},
			{type: "started", key: "v2:aa", agentId: "a1", label: "probe", phase: "Inventory"},
			{type: "result", key: "v2:aa", agentId: "a1", result: null, toolsUsed: ["Bash", "StructuredOutput"]},
		]);

		expect(readWorkflowRuns(transcriptPath)[0]?.progress).toStrictEqual([
			{type: "workflow_phase", index: 1, title: "Inventory"},
			{
				type: "workflow_agent",
				index: 1,
				label: "probe",
				agentId: "a1",
				state: "done",
				phaseIndex: 1,
				phaseTitle: "Inventory",
				toolsUsed: ["Bash", "StructuredOutput"],
			},
		]);
	});

	it("carries a journal result's toolsUsed onto a completed run's agent entry by agent id", () => {
		writeTranscript([launch("toolu_A", "wxkmbdj52", "2026-10-01T12:00:00.000Z")]);
		writeRunFile({
			runId: RUN,
			timestamp: "2026-10-01T12:10:00.000Z",
			taskId: "wxkmbdj52",
			script: "",
			scriptPath: join(sessionDir, "workflows", "scripts", `outline-upstream-sync-${RUN}.js`),
			result: null,
			agentCount: 2,
			logs: [],
			durationMs: 600_000,
			summary: "Feature-by-feature parity investigation",
			workflowName: "outline-upstream-sync",
			status: "completed",
			startTime: 1_790_971_610_323,
			phases: [],
			defaultModel: "claude-opus-5-5",
			workflowProgress: [
				{type: "workflow_agent", index: 1, label: "one", agentId: "a1", state: "done"},
				{type: "workflow_agent", index: 2, label: "two", agentId: "a2", state: "done"},
			],
			totalTokens: 0,
			totalToolCalls: 0,
		});
		writeJournal([
			{type: "launched"},
			{type: "started", key: "v2:aa", agentId: "a1"},
			{type: "result", key: "v2:aa", agentId: "a1", result: null, toolsUsed: ["Read"]},
			{type: "started", key: "v2:bb", agentId: "a2"},
			{type: "result", key: "v2:bb", agentId: "a2", result: null},
		]);

		expect(readWorkflowRuns(transcriptPath)[0]?.progress).toStrictEqual([
			{type: "workflow_agent", index: 1, label: "one", agentId: "a1", state: "done", toolsUsed: ["Read"]},
			{type: "workflow_agent", index: 2, label: "two", agentId: "a2", state: "done"},
		]);
	});

	it("marks failed journal agents as errors", () => {
		writeTranscript([launch("toolu_A", "wxkmbdj52", "2026-10-01T12:00:00.000Z")]);
		writeJournal([
			{type: "launched"},
			{type: "started", key: "v2:aa", agentId: "a1", label: "probe", phase: "Inventory"},
			{type: "failed", key: "v2:aa", agentId: "a1"},
		]);

		expect(readWorkflowRuns(transcriptPath)[0]?.progress).toStrictEqual([
			{type: "workflow_phase", index: 1, title: "Inventory"},
			{
				type: "workflow_agent",
				index: 1,
				label: "probe",
				agentId: "a1",
				state: "error",
				phaseIndex: 1,
				phaseTitle: "Inventory",
			},
		]);
	});

	it("reads a stopped run's status and summary from its task-notification", () => {
		writeTranscript([
			launch("toolu_A", "wxkmbdj52", "2026-10-01T12:00:00.000Z"),
			queuedNotification(
				notificationText("wxkmbdj52", "toolu_A", "killed", 'Workflow "outline-upstream-sync" was killed'),
			),
			userNotification(
				notificationText("wxkmbdj52", "toolu_A", "killed", 'Workflow "outline-upstream-sync" was killed'),
			),
		]);

		expect(readWorkflowRuns(transcriptPath)).toStrictEqual<WorkflowRun[]>([
			{
				...launchFields(),
				taskId: "wxkmbdj52",
				toolUseId: "toolu_A",
				toolUseIds: ["toolu_A"],
				status: "stopped",
				summary: 'Workflow "outline-upstream-sync" was killed',
				startedAt: Date.parse("2026-10-01T12:00:00.000Z"),
				durationMs: 4210,
				totalTokens: null,
				progress: [],
			},
		]);
	});

	it("keeps one run per runId and lets the latest launch of a resumed run win", () => {
		writeTranscript([
			launch("toolu_A", "wxkmbdj52", "2026-10-01T12:00:00.000Z"),
			userNotification(notificationText("wxkmbdj52", "toolu_A", "completed", "first")),
			launch("toolu_B", "wzgt6ws2h", "2026-10-01T13:00:00.000Z"),
			userNotification(notificationText("wzgt6ws2h", "toolu_B", "stopped", "second")),
			launch("toolu_C", "wmyxatopy", "2026-10-01T14:00:00.000Z"),
		]);
		// The run file still describes the first launch: it must not settle the third.
		writeRunFile({
			runId: RUN,
			timestamp: "2026-10-01T12:10:00.000Z",
			taskId: "wxkmbdj52",
			script: "",
			scriptPath: "",
			result: null,
			agentCount: 0,
			logs: [],
			durationMs: 600_000,
			summary: "Feature-by-feature parity investigation",
			workflowName: "outline-upstream-sync",
			status: "completed",
			startTime: 1,
			phases: [],
			defaultModel: "claude-opus-5-5",
			workflowProgress: [{type: "workflow_phase", index: 1, title: "Old"}],
			totalTokens: 5,
			totalToolCalls: 0,
		});
		writeJournal([{type: "launched"}, {type: "started", key: "v2:aa", agentId: "a1", label: "probe"}]);

		expect(readWorkflowRuns(transcriptPath)).toStrictEqual<WorkflowRun[]>([
			{
				...launchFields(),
				taskId: "wmyxatopy",
				toolUseId: "toolu_C",
				toolUseIds: ["toolu_A", "toolu_B", "toolu_C"],
				status: "running",
				summary: null,
				startedAt: Date.parse("2026-10-01T14:00:00.000Z"),
				durationMs: null,
				totalTokens: null,
				progress: [{type: "workflow_agent", index: 1, label: "probe", agentId: "a1", state: "progress"}],
			},
		]);
	});

	it("returns runs the API response schema accepts unchanged", () => {
		writeTranscript([launch("toolu_A", "wxkmbdj52", "2026-10-01T12:00:00.000Z")]);
		writeJournal([
			{type: "launched"},
			{type: "started", key: "v2:aa", agentId: "a1", label: "probe", phase: "Inventory"},
		]);
		const runs = readWorkflowRuns(transcriptPath);

		expect(SessionWorkflowRunsResponse.parse(runs)).toStrictEqual(runs);
	});

	it("returns no runs for a missing transcript", () => {
		expect(readWorkflowRuns(join(projectDir, "missing.jsonl"))).toStrictEqual([]);
	});
});

describe("workflowSessionIdForPath", () => {
	it.each([
		["<p>/<s>/workflows/wf_1.json", SESSION],
		["<p>/<s>/subagents/workflows/wf_1/journal.jsonl", SESSION],
		["<p>/<s>/subagents/workflows/wf_1/agent-a1.jsonl", SESSION],
		["<p>/<s>/subagents/workflows/wf_1/agent-a1.meta.json", SESSION],
		["<p>/<s>/workflows/scripts/x.js", null],
		["<p>/<s>/subagents/agent-a1.jsonl", null],
		["<p>/<s>.jsonl", null],
		["/elsewhere/<s>/workflows/wf_1.json", null],
	] as const)("%s → %s", (template, expected) => {
		const path = template
			.replace("<p>", join(projectsDir, "-Users-alice-projects-outline"))
			.replace("<s>", SESSION);
		expect(workflowSessionIdForPath(path, projectsDir)).toBe(expected);
	});
});

describe("workflow schemas", () => {
	it("accepts a result journal event with toolsUsed", () => {
		const event = {
			type: "result",
			key: "v2:f1ec",
			agentId: "a9fc1c85cc36d863d",
			result: {none: false, head: "7b529a88", clean: true},
			toolsUsed: ["Bash", "StructuredOutput"],
		};
		expect(WorkflowJournalEventSchema.parse(event)).toStrictEqual(event);
	});

	it("accepts an agent meta file with isBuiltIn", () => {
		const meta = {
			agentType: "workflow-subagent",
			isBuiltIn: true,
			description: "task-1",
			workflowPhase: "Tasks",
			spawnDepth: 1,
			requestShape: "foreground",
			requestNonInteractive: false,
			model: "sonnet",
		};
		expect(WorkflowAgentMetaSchema.parse(meta)).toStrictEqual(meta);
	});
});

/** The paths `pick` selects for every ~/.claude/projects/<project>/<session> entry. */
function diskFiles(pick: (sessionDir: string) => string[]): string[] {
	const root = join(homedir(), ".claude", "projects");
	const list = (dir: string): string[] => {
		try {
			return readdirSync(dir);
		} catch {
			return [];
		}
	};
	return list(root).flatMap((project) =>
		list(join(root, project)).flatMap((session) => pick(join(root, project, session))),
	);
}

function listDir(dir: string, suffix: string): string[] {
	try {
		return readdirSync(dir)
			.filter((file) => file.endsWith(suffix))
			.map((file) => join(dir, file));
	} catch {
		return [];
	}
}

const runTranscriptDirs = (session: string): string[] =>
	listDir(join(session, "subagents", "workflows"), "").filter((dir) => !dir.endsWith(".jsonl"));

describe("workflow schemas against disk", () => {
	it("validates every workflows/<runId>.json run file", () => {
		const failures = diskFiles((session) => listDir(join(session, "workflows"), ".json")).flatMap((file) => {
			const result = WorkflowRunFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
			return result.success ? [] : [`${file}: ${result.error.message}`];
		});
		expect(failures).toStrictEqual([]);
	});

	it("validates every workflow journal event and agent meta file", () => {
		const failures = diskFiles((session) => runTranscriptDirs(session)).flatMap((dir) => {
			const journal = listDir(dir, "journal.jsonl").flatMap((file) =>
				readFileSync(file, "utf8")
					.split("\n")
					.filter((line) => line !== "")
					.flatMap((line, i) => {
						const result = WorkflowJournalEventSchema.safeParse(JSON.parse(line));
						return result.success ? [] : [`${file}:${i + 1}: ${result.error.message}`];
					}),
			);
			const metas = listDir(dir, ".meta.json").flatMap((file) => {
				const result = WorkflowAgentMetaSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
				return result.success ? [] : [`${file}: ${result.error.message}`];
			});
			return [...journal, ...metas];
		});
		expect(failures).toStrictEqual([]);
	});
});
