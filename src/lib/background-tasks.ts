import type {HookBackgroundTaskPayload} from "./hook-events";
import {asRecord} from "./narrow";
import {isRunningBackgroundTask} from "./session-state";
import type {ActiveSubagent} from "./subagents";

export type BackgroundTaskKind = "bash" | "agent" | "monitor" | "task";
export type BackgroundTaskStatus = "running" | "completed" | "failed" | "stopped";

/** One row of the Background tasks pane. */
export interface BackgroundTask {
	/** The harness task id when known, otherwise the launching tool_use id. */
	id: string;
	toolUseId: string | null;
	kind: BackgroundTaskKind;
	description: string;
	command: string | null;
	status: BackgroundTaskStatus;
	/** TaskOutput/BashOutput output, Monitor events, or an agent's result. */
	output: string | null;
	/** The latest task-notification summary line. */
	summary: string | null;
	/**
	 * The CLI's `tasks/<id>.output` file the command writes to, from its launch
	 * result or notification. Never set for agents, whose file is their JSONL transcript.
	 */
	outputFile: string | null;
}

export interface BackgroundTaskGroups {
	running: BackgroundTask[];
	finished: BackgroundTask[];
}

/** Live state the transcript window cannot show. */
export interface BackgroundTaskLiveState {
	/** Without a live session, transcript tasks that never finished are shown stopped. */
	sessionActive: boolean;
	/** The latest Stop hook's `background_tasks`. */
	hookTasks?: readonly HookBackgroundTaskPayload[];
	runningSubagents?: readonly ActiveSubagent[];
	/** When the session's current CLI process started (its registry entry); in-process teammates spawned before it are gone. */
	processStartedAt?: number | null;
	/** The session's indexed subagents, whose in-process teammates may have been spawned outside the loaded transcript. */
	teammates?: readonly TeammateCandidate[];
}

/** An indexed subagent, as `/api/sessions/$id/subagents` reports it. */
export interface TeammateCandidate {
	id: string;
	name?: string | null | undefined;
	description: string | null;
	startedAt: string | null;
	taskKind?: string | null | undefined;
	stopped?: true | undefined;
	/** The description of the teammate's foreground Bash call still waiting on its result. */
	pendingCommand?: string | null | undefined;
}

const IN_PROCESS_TEAMMATE = "in_process_teammate";

function spawnedSince(startedAt: string | null, processStartedAt: number | null | undefined): boolean {
	if (processStartedAt == null || startedAt === null) return false;
	return Date.parse(startedAt) >= processStartedAt;
}

const KIND_LABELS: Record<BackgroundTaskKind, string> = {
	bash: "Bash",
	agent: "Agent",
	monitor: "Monitor",
	task: "Task",
};

const STATUS_LABELS: Record<BackgroundTaskStatus, string> = {
	running: "Running",
	completed: "Completed",
	failed: "Failed",
	stopped: "Stopped",
};

/** The card's meta line, e.g. "Bash · Completed". */
export function backgroundTaskMeta(task: BackgroundTask): string {
	return `${KIND_LABELS[task.kind]} · ${STATUS_LABELS[task.status]}`;
}

/** Running tasks in the given order; finished ones newest first. */
export function groupBackgroundTasks(tasks: readonly BackgroundTask[]): BackgroundTaskGroups {
	return {
		running: tasks.filter((task) => task.status === "running"),
		finished: tasks.filter((task) => task.status !== "running").toReversed(),
	};
}

/**
 * View options facts for the pane: `total` counts what the pane lists (task
 * rows, plus the session's subagents, which the pane links to).
 */
export function backgroundTasksFacts(
	groups: BackgroundTaskGroups,
	subagentCount: number,
): {total: number; running: number} {
	return {
		total: groups.running.length + groups.finished.length + subagentCount,
		running: groups.running.length,
	};
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => asString(asRecord(block)?.["text"]) ?? "")
		.filter((text) => text !== "")
		.join("\n");
}

function tag(text: string, name: string): string | null {
	const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text);
	return match?.[1] === undefined ? null : match[1].trim();
}

function allTags(text: string, name: string): string[] {
	return [...text.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((match) =>
		(match[1] ?? "").trim(),
	);
}

function notificationStatus(status: string | null): Exclude<BackgroundTaskStatus, "running"> | null {
	switch (status) {
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "killed":
		case "stopped":
			return "stopped";
		default:
			return null;
	}
}

/** A finished background task, as its `<task-notification>` reports it. */
export interface TaskNotification {
	/** The finished task's id, which is also the agent id a background Agent's hand-back names. */
	taskId: string | null;
	toolUseId: string | null;
	status: Exclude<BackgroundTaskStatus, "running">;
	/** A `run_in_background` Bash command rather than an agent or monitor. */
	command: boolean;
	/** A background Agent, whose completion upstream settles on its own "Ran agent" row. */
	agent: boolean;
	description: string;
	/** How long the task ran, from the notification's `<usage><duration_ms>`. */
	durationMs: number | null;
}

const STOPPED_AGENT = /^Background agent "(.+)" was stopped by the user\.$/;

/**
 * The description of the background agent a plain-text task notification
 * reports the user stopped ('Background agent "..." was stopped by the user.'),
 * or null for any other text.
 */
export function stoppedAgentDescription(text: string): string | null {
	return STOPPED_AGENT.exec(text.trim())?.[1] ?? null;
}

function durationOf(text: string | null): number | null {
	if (text === null || !/^\d+$/.test(text)) return null;
	return Number(text);
}

/**
 * The finished task a user turn announces when it opens with a
 * `<task-notification>` block, or null for any other text and for
 * notifications that carry no terminal status (Monitor events).
 */
export function parseTaskNotification(text: string): TaskNotification | null {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith("<task-notification>")) return null;
	const status = notificationStatus(tag(trimmed, "status"));
	if (status === null) return null;
	const summary = tag(trimmed, "summary") ?? "";
	return {
		taskId: tag(trimmed, "task-id"),
		toolUseId: tag(trimmed, "tool-use-id"),
		status,
		command: summary.startsWith("Background command"),
		agent: summary.startsWith("Agent "),
		description: /"([^"]*)"/.exec(summary)?.[1] ?? summary,
		durationMs: durationOf(tag(trimmed, "duration_ms")),
	};
}

const MONITOR_EXPIRED = "[Monitor expired";

/** The `<task-notification>` a queued_command attachment or a queue enqueue carries, or null. */
function queuedNotification(record: Readonly<Record<string, unknown>>): string | null {
	if (record["type"] === "attachment") {
		const attachment = asRecord(record["attachment"]);
		return attachment?.["type"] === "queued_command" ? asString(attachment["prompt"]) : null;
	}
	if (record["type"] === "queue-operation" && record["operation"] === "enqueue") return asString(record["content"]);
	return null;
}

function hookKind(type: string): BackgroundTaskKind {
	if (type.includes("bash") || type.includes("shell")) return "bash";
	if (type.includes("agent")) return "agent";
	if (type.includes("monitor")) return "monitor";
	return "task";
}

const LAUNCH_ID_PATTERNS = [
	/running in background with ID: (\S+?)\.?(?:\s|$)/,
	/Monitor started \(task (\S+?)[,)]/,
	/agentId:\s*(\S+)/,
];

const LAUNCH_OUTPUT_FILE = /Output is being written to: (\S+?)\.?(?:\s|$)/;

function launchedTaskId(result: Readonly<Record<string, unknown>> | undefined, text: string): string | null {
	for (const key of ["backgroundTaskId", "taskId", "agentId"]) {
		const id = asString(result?.[key]);
		if (id !== null) return id;
	}
	for (const pattern of LAUNCH_ID_PATTERNS) {
		const id = pattern.exec(text)?.[1];
		if (id !== undefined) return id;
	}
	return null;
}

interface Tracked {
	task: BackgroundTask;
	/** Order of the last status change, for newest-finished-first. */
	settledAt: number;
}

function unprefixedAgentId(id: string): string {
	return id.startsWith("agent-") ? id.slice("agent-".length) : id;
}

/**
 * Background work in a session: `run_in_background` Bash and Agent calls and
 * Monitor watches, settled by their `<task-notification>` records and filled
 * in by TaskOutput/BashOutput reads, plus running subagents and Stop-hook
 * `background_tasks` the transcript window does not show.
 */
export function extractBackgroundTasks(
	records: readonly Readonly<Record<string, unknown>>[],
	live: BackgroundTaskLiveState,
): BackgroundTaskGroups {
	const tasks: Tracked[] = [];
	const byToolUseId = new Map<string, Tracked>();
	const byTaskId = new Map<string, Tracked>();
	/** Launch calls awaiting the result that says whether (and as what) they backgrounded. */
	const pendingAgents = new Map<string, {description: string}>();
	const readers = new Map<string, string>();
	const stoppers = new Map<string, string>();
	let clock = 0;

	const track = (task: BackgroundTask): Tracked => {
		const tracked = {task, settledAt: 0};
		tasks.push(tracked);
		if (task.toolUseId !== null) byToolUseId.set(task.toolUseId, tracked);
		return tracked;
	};
	const find = (taskId: string | null, toolUseId: string | null): Tracked | undefined =>
		(toolUseId === null ? undefined : byToolUseId.get(toolUseId)) ??
		(taskId === null ? undefined : byTaskId.get(taskId));
	const settle = (tracked: Tracked, status: BackgroundTaskStatus): void => {
		tracked.task.status = status;
		tracked.settledAt = ++clock;
	};

	// The CLI writes one notification as a user record, a queued_command attachment or a queue enqueue, often more than one of these.
	const seenNotifications = new Set<string>();
	const applyNotification = (content: string): void => {
		if (!content.startsWith("<task-notification>") || seenNotifications.has(content)) return;
		seenNotifications.add(content);
		{
			const toolUseId = tag(content, "tool-use-id");
			const status = notificationStatus(tag(content, "status"));
			const summary = tag(content, "summary");
			for (const taskId of allTags(content, "task-id")) {
				const tracked = find(taskId, toolUseId);
				if (tracked === undefined) continue;
				if (summary !== null) tracked.task.summary = summary;
				const outputFile = tag(content, "output-file");
				if (outputFile !== null && tracked.task.kind !== "agent") tracked.task.outputFile = outputFile;
				const event = tag(content, "event");
				if (event !== null) {
					tracked.task.output = tracked.task.output === null ? event : `${tracked.task.output}\n${event}`;
				}
				const result = tag(content, "result");
				if (result !== null) tracked.task.output = result;
				if (status !== null) settle(tracked, status);
				// A monitor ends with an expiry event that carries no status.
				else if (event?.startsWith(MONITOR_EXPIRED) === true) settle(tracked, "completed");
			}
		}
	};

	for (const record of records) {
		const message = asRecord(record["message"]);
		const content = message?.["content"];

		if (record["type"] === "user" && typeof content === "string") {
			applyNotification(content);
			continue;
		}
		const queued = queuedNotification(record);
		if (queued !== null) {
			applyNotification(queued);
			continue;
		}

		if (!Array.isArray(content)) continue;
		for (const raw of content) {
			const block = asRecord(raw);
			if (block === undefined) continue;

			if (block["type"] === "tool_use") {
				const id = asString(block["id"]);
				const name = asString(block["name"]);
				const input = asRecord(block["input"]) ?? {};
				if (id === null) continue;
				const background = input["run_in_background"] === true;
				const description = asString(input["description"]);
				const command = asString(input["command"]);
				if (name === "Bash" && background) {
					track({
						id,
						toolUseId: id,
						kind: "bash",
						description: description ?? command ?? "",
						command,
						status: "running",
						output: null,
						summary: null,
						outputFile: null,
					});
				} else if (name === "Monitor") {
					track({
						id,
						toolUseId: id,
						kind: "monitor",
						description: description ?? command ?? "",
						command,
						status: "running",
						output: null,
						summary: null,
						outputFile: null,
					});
				} else if (name === "Agent") {
					pendingAgents.set(id, {description: description ?? ""});
				} else if (name === "TaskOutput" || name === "BashOutput") {
					const taskId = asString(input["task_id"]) ?? asString(input["bash_id"]);
					if (taskId !== null) readers.set(id, taskId);
				} else if (name === "TaskStop" || name === "KillShell") {
					const taskId = asString(input["task_id"]) ?? asString(input["shell_id"]);
					if (taskId !== null) stoppers.set(id, taskId);
				}
				continue;
			}

			if (block["type"] !== "tool_result") continue;
			const toolUseId = asString(block["tool_use_id"]);
			if (toolUseId === null) continue;
			const text = textOf(block["content"]);
			const result = asRecord(record["toolUseResult"]);
			const isError = block["is_error"] === true;

			const agent = pendingAgents.get(toolUseId);
			if (agent !== undefined && result?.["status"] === "teammate_spawned") {
				// An in-process teammate lives as long as the process that spawned it; upstream counts it as a task.
				pendingAgents.delete(toolUseId);
				if (!spawnedSince(asString(record["timestamp"]), live.processStartedAt)) continue;
				const agentId =
					asString(result["agent_id"]) ?? asString(result["agentId"]) ?? launchedTaskId(result, text);
				const tracked = track({
					id: agentId ?? toolUseId,
					toolUseId,
					kind: "agent",
					description: agent.description,
					command: null,
					status: "running",
					output: null,
					summary: null,
					outputFile: null,
				});
				if (agentId !== null) byTaskId.set(agentId, tracked);
				// TaskStop names a teammate by its name as often as by its id.
				const name = asString(result["name"]);
				if (name !== null) byTaskId.set(name, tracked);
				continue;
			}
			if (agent !== undefined) {
				pendingAgents.delete(toolUseId);
				if (result?.["isAsync"] === true || text.startsWith("Async agent launched")) {
					const taskId = launchedTaskId(result, text);
					const tracked = track({
						id: taskId ?? toolUseId,
						toolUseId,
						kind: "agent",
						description: agent.description,
						command: null,
						status: "running",
						output: null,
						summary: null,
						outputFile: null,
					});
					if (taskId !== null) byTaskId.set(taskId, tracked);
				}
				continue;
			}

			const launched = byToolUseId.get(toolUseId);
			if (launched !== undefined) {
				if (isError) {
					tasks.splice(tasks.indexOf(launched), 1);
					byToolUseId.delete(toolUseId);
					continue;
				}
				const taskId = launchedTaskId(result, text);
				if (taskId !== null) {
					launched.task.id = taskId;
					byTaskId.set(taskId, launched);
				}
				const outputFile = LAUNCH_OUTPUT_FILE.exec(text)?.[1];
				if (outputFile !== undefined) launched.task.outputFile = outputFile;
				continue;
			}

			const readTaskId = readers.get(toolUseId);
			if (readTaskId !== undefined) {
				const tracked = byTaskId.get(readTaskId);
				const output = tag(text, "output") ?? tag(text, "stdout");
				if (tracked !== undefined && output !== null) tracked.task.output = output;
				continue;
			}

			const stopTaskId = stoppers.get(toolUseId);
			if (stopTaskId !== undefined && !isError) {
				const tracked = byTaskId.get(stopTaskId);
				if (tracked?.task.status === "running") settle(tracked, "stopped");
			}
		}
	}

	if (!live.sessionActive) {
		for (const tracked of tasks) {
			if (tracked.task.status === "running") settle(tracked, "stopped");
		}
	}

	const liveTasks: BackgroundTask[] = [];
	for (const subagent of live.runningSubagents ?? []) {
		const agentId = unprefixedAgentId(subagent.agentId);
		if (byToolUseId.has(subagent.key) || (agentId !== "" && byTaskId.has(agentId))) continue;
		liveTasks.push({
			id: agentId === "" ? subagent.key : agentId,
			toolUseId: agentId === "" ? subagent.key : null,
			kind: "agent",
			description: subagent.description,
			command: null,
			status: "running",
			output: null,
			summary: null,
			outputFile: null,
		});
	}
	for (const teammate of live.teammates ?? []) {
		if (teammate.taskKind !== IN_PROCESS_TEAMMATE) continue;
		const agentId = unprefixedAgentId(teammate.id);
		const known = byTaskId.get(agentId);
		if (teammate.stopped === true) {
			if (known?.task.status === "running") settle(known, "stopped");
			continue;
		}
		if (!live.sessionActive || known !== undefined || !spawnedSince(teammate.startedAt, live.processStartedAt))
			continue;
		liveTasks.push({
			id: agentId,
			toolUseId: null,
			kind: "agent",
			description: teammate.description ?? teammate.name ?? agentId,
			command: null,
			status: "running",
			output: null,
			summary: null,
			outputFile: null,
		});
	}
	// A running teammate's in-flight foreground command is a task of its own upstream.
	for (const teammate of live.teammates ?? []) {
		if (teammate.taskKind !== IN_PROCESS_TEAMMATE || teammate.pendingCommand == null) continue;
		const agentId = unprefixedAgentId(teammate.id);
		const running =
			byTaskId.get(agentId)?.task.status === "running" || liveTasks.some((task) => task.id === agentId);
		if (!running) continue;
		liveTasks.push({
			id: `${agentId}:command`,
			toolUseId: null,
			kind: "bash",
			description: teammate.pendingCommand,
			command: null,
			status: "running",
			output: null,
			summary: null,
			outputFile: null,
		});
	}
	for (const hookTask of live.hookTasks ?? []) {
		if (!isRunningBackgroundTask(hookTask)) continue;
		const id = unprefixedAgentId(hookTask.id);
		if (byTaskId.has(id) || liveTasks.some((task) => task.id === id)) continue;
		liveTasks.push({
			id,
			toolUseId: null,
			kind: hookKind(hookTask.type),
			description: hookTask.description,
			command: hookTask.command ?? null,
			status: "running",
			output: null,
			summary: null,
			outputFile: null,
		});
	}

	const ordered = [
		...tasks.filter((tracked) => tracked.task.status === "running").map((t) => t.task),
		...liveTasks,
		...tasks
			.filter((tracked) => tracked.task.status !== "running")
			.toSorted((a, b) => a.settledAt - b.settledAt)
			.map((tracked) => tracked.task),
	];
	return groupBackgroundTasks(ordered);
}
